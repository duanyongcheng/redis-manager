/** Browser regressions for previews, CLI input and application state. No Redis is used.
 * Run: node scripts/test-value-preview.mjs [screenshot-directory]
 * CHROME_BIN can select a different locally installed Chromium executable.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { testRefreshState } from "./test-refresh-state.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const screenshots = process.argv[2] && resolve(process.argv[2]);
const profile = await mkdtemp(join(tmpdir(), "redis-preview-test-"));
const server = await createServer({ root, configFile: false, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
let chrome;
let ws;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
  let port;
  await until(async () => {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return Boolean(port); } catch { return false; }
  }, "Chrome startup");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async function evaluate(expression, context = {}) {
    const result = await send("Runtime.evaluate", { expression, contextId: context.contextId, returnByValue: true, awaitPromise: true }, context.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  const frameSessions = new Map();
  async function frameContext() {
    let context;
    await until(async () => {
      // Chromium may put an opaque-origin sandbox in a separate process.
      const { targetInfos } = await send("Target.getTargets");
      const target = targetInfos.find((item) => item.type === "iframe" && item.url === "about:srcdoc");
      if (target) {
        if (!frameSessions.has(target.targetId)) {
          const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
          frameSessions.set(target.targetId, sessionId);
          await send("Runtime.enable", {}, sessionId);
        }
        context = { sessionId: frameSessions.get(target.targetId) };
        return true;
      }
      const { frameTree } = await send("Page.getFrameTree");
      const frame = frameTree.childFrames?.find(({ frame }) => frame.url === "about:srcdoc")?.frame;
      if (!frame) return false;
      context = { contextId: (await send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "preview-regression" })).executionContextId };
      return true;
    }, "HTML iframe execution context");
    return context;
  }
  const fixture = (await readFile(join(root, "scripts/fixtures/value-preview.html"), "utf8"))
    .replace("</table>", `${Array.from({ length: 28 }, (_, index) => `<tr><td class="label">附加项目 ${index + 1}</td><td>用于滚动位置验证的示例内容</td></tr>`).join("\n")}</table>`)
    .replace(/\n/g, "\r\n");
  const markdown = "# 业务说明\r\n\r\n**预览示例**\r\n\r\n| 项目 | 值 |\r\n| --- | --- |\r\n| 产品 | 示例 |";
  const values = {
    "preview:quoted-html": JSON.stringify(fixture),
    "preview:html": "<h1>HTML 片段</h1><p>路径 C:\\new\\template 和正则 \\t 保持原样</p>",
    "preview:markdown": JSON.stringify(markdown),
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const fixtureScript = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__previewValues = ${JSON.stringify(values)};
    window.__overviewCalls = 0;
    window.__cliCalls = [];
    window.__appInfo = {version: "1.7.8", isDev: false, updatesEnabled: true};
    window.__updateChecks = 0;
    window.AppService = {
      getAppInfo: async () => window.__appInfo,
      checkForUpdates: async () => {
        window.__updateChecks += 1;
        if (window.__updateCheckError) throw new Error(window.__updateCheckError);
        if (window.__holdUpdateCheck) await new Promise(resolve => { window.__finishUpdateCheck = resolve; });
      },
    };
    const connections = ["preview", "second"].map(id => ({id, name: id === "preview" ? "预览验证" : "第二个测试连接", group: "Local", host: "localhost", port: 6379, db: 0, mode: "standalone", tls: false, readOnly: true}));
    const keys = Object.keys(window.__previewValues).map(key => ({key, type: "string", ttlMs: -1, sizeBytes: window.__previewValues[key].length, encoding: "raw"}));
    window.RedisService = {
      listConnections: async () => connections,
      getOverview: async () => ({atMs: Date.now(), opsPerSec: ++window.__overviewCalls, connectedClients: 1, usedMemoryBytes: 1024, maxMemoryBytes: 8192, latencyMs: 1, totalKeys: keys.length, keyspaces: [{db: 0, keys: keys.length, expires: 0, avgTtlMs: 0}], commands: [], info: {redis_version: "test"}}),
      scanKeys: async () => ({keys, cursor: 0, done: true}),
      getValue: async (_id, _db, key) => ({...keys.find(item => item.key === key), stringValue: window.__previewValues[key]}),
      execCLI: async (id, db, command, readOnly) => {
        window.__cliCalls.push({id, db, command, readOnly});
        if (window.__holdCli) await new Promise(resolve => { window.__finishCli = resolve; });
        return {lines: [{kind: 'string', text: 'result: ' + command}]};
      },
    };
  ` });
  await send("Page.navigate", { url: `${url}/?page=browser&theme=airy&scheme=dark` });
  await send("Page.bringToFront");
  await until(() => evaluate("Boolean(document.querySelector('[data-view=raw]'))"), "first key");
  const decoderCases = await evaluate(`import('/src/core/format.ts').then(({ decodeJsonString }) => [
    decodeJsonString('not JSON'),
    decodeJsonString('{"body":"unchanged"}'),
    decodeJsonString('"unterminated'),
    decodeJsonString(JSON.stringify(JSON.stringify('<h1>one layer</h1>'))),
  ])`);
  assert.deepEqual(decoderCases, [
    { text: "not JSON", encoded: false },
    { text: '{"body":"unchanged"}', encoded: false },
    { text: '"unterminated', encoded: false },
    { text: JSON.stringify("<h1>one layer</h1>"), encoded: true },
  ], "decode only a valid string wrapper, never an object or blind escape replacement");
  assert.equal(await evaluate("document.querySelector('[data-view=raw]').textContent"), values["preview:quoted-html"], "raw data stays byte-for-byte unchanged");
  await evaluate("document.querySelector('[data-seg-value=html]').click()");
  await until(() => evaluate("Boolean(document.querySelector('iframe.html-preview:not(.hidden)'))"), "HTML preview");
  let context = await frameContext();
  await until(() => evaluate("Boolean(document.querySelector('h3'))", context), "document rendering");
  const documentState = await evaluate(`({title: document.querySelector('h3').textContent, text: document.body.innerText, tableCount: document.querySelectorAll('table').length, labelColor: getComputedStyle(document.querySelector('.label')).backgroundColor, borderColor: getComputedStyle(document.querySelector('td')).borderTopColor, font: getComputedStyle(document.querySelector('h3')).fontSize, scriptRan: document.body.dataset.previewScriptRan || null})`, context);
  assert.equal(documentState.title, "认/申购交易业务申请表");
  assert.ok(!documentState.text.includes("\\r\\n"), "decoded CRLF must not appear as literal text");
  assert.ok(!documentState.text.includes('\\"'), "JSON quote escapes must be decoded");
  assert.ok(documentState.text.includes('${fundName!""}'), "template placeholders are preserved without evaluation");
  assert.equal(documentState.tableCount, 1);
  assert.equal(documentState.labelColor, "rgb(238, 236, 225)", "authored cell styles survive");
  assert.equal(documentState.borderColor, "rgb(0, 0, 0)", "authored borders survive");
  assert.equal(documentState.font, "20px", "authored heading size survives");
  assert.equal(documentState.scriptRan, null, "stored scripts must not execute");
  assert.equal(await evaluate("document.querySelector('iframe').getAttribute('sandbox')"), "", "preview has no script or same-origin permissions");
  assert.equal(await evaluate("document.querySelector('iframe').contentDocument === null"), true, "preview stays isolated from the host document");
  await evaluate("window.__keptFrame = document.querySelector('iframe.html-preview'); window.__startPolls = window.__overviewCalls");
  await evaluate("window.scrollTo(0, 280)", context);
  await until(() => evaluate("window.__overviewCalls >= window.__startPolls + 2"), "two actual polling refreshes", 12000);
  await evaluate("import('/src/core/store.ts').then(store => store.toast('info', '后台刷新验证'))");
  await sleep(200);
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "html", "mode survives polling and notifications");
  assert.equal(await evaluate("window.__keptFrame === document.querySelector('iframe.html-preview') && window.__keptFrame.isConnected"), true, "unchanged iframe stays connected");
  context = await frameContext();
  assert.equal(await evaluate("window.scrollY", context), 280, "iframe reading position survives background refresh");
  assert.equal(await evaluate("document.querySelector('.statusbar').textContent.includes(String(window.__overviewCalls))"), true, "background metrics still refresh");
  await evaluate("window.__RM_SETTINGS__.patch({theme:'console', scheme:'dark'})");
  await sleep(100);
  assert.equal(await evaluate("window.__keptFrame === document.querySelector('iframe.html-preview')"), true, "theme changes also preserve the document");
  assert.equal(await evaluate("window.scrollY", context), 280, "theme change preserves reading position");
  await evaluate("window.__RM_SETTINGS__.patch({theme:'airy', scheme:'dark'})");
  await sleep(100);
  const layout = await evaluate(`(() => {
    const body = document.querySelector('.value-body');
    const frame = document.querySelector('iframe').getBoundingClientRect();
    const footer = document.querySelector('.value-foot').getBoundingClientRect();
    return {overflow: body.scrollHeight - body.clientHeight, frameBottom: frame.bottom, footerTop: footer.top};
  })()`);
  assert.ok(layout.overflow <= 1, `the value pane must not add a second scrollbar (${layout.overflow}px overflow)`);
  assert.ok(layout.frameBottom <= layout.footerTop, "preview fits above the footer");
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await evaluate("window.scrollTo(0, 0)", context);
    await evaluate("import('/src/core/store.ts').then(store => store.patch({toasts: []}))");
    await sleep(150);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(screenshots, "html-preview.png"), Buffer.from(shot.data, "base64"));
  }
  await evaluate("document.querySelector('[data-action=reload-value]').click()");
  await sleep(150);
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "html", "refreshing this key retains mode");
  await evaluate("document.querySelector('[data-key=\"preview:html\"]').click()");
  await until(() => evaluate("window.__RM_STATE__.value?.key === 'preview:html'"), "another key");
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "raw", "another key starts in raw mode");
  await evaluate("document.querySelector('[data-seg-value=html]').click()");
  await sleep(150);
  context = await frameContext();
  assert.ok((await evaluate("document.body.innerText", context)).includes("C:\\new\\template"), "ordinary backslashes are not blindly decoded");
  await evaluate("window.__previewValues['preview:html'] = '<h1>内容已更新</h1>'; document.querySelector('[data-action=reload-value]').click()");
  await sleep(150);
  context = await frameContext();
  assert.equal(await evaluate("document.querySelector('h1').textContent", context), "内容已更新", "a changed value updates the existing preview mode");
  await evaluate("document.querySelector('[data-key=\"preview:markdown\"]').click()");
  await until(() => evaluate("window.__RM_STATE__.value?.key === 'preview:markdown'"), "Markdown key");
  await evaluate("document.querySelector('[data-seg-value=markdown]').click()");
  await until(() => evaluate("Boolean(document.querySelector('.markdown-preview:not(.hidden) h1'))"), "Markdown preview");
  assert.equal(await evaluate("document.querySelector('.markdown-preview h1').textContent"), "业务说明");
  await evaluate("import('/src/core/store.ts').then(store => store.loadOverview())");
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "markdown", "Markdown mode survives metrics update");
  assert.equal(await evaluate("document.querySelector('.markdown-preview table th').textContent"), "项目", "decoded Markdown tables render");
  if (screenshots) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(screenshots, "markdown-preview.png"), Buffer.from(shot.data, "base64"));
  }
  await evaluate("const db = document.querySelector('[data-db-select]'); db.value = '1'; db.dispatchEvent(new Event('change', {bubbles:true}))");
  await until(() => evaluate("window.__RM_STATE__.dbByConn.preview === 1 && window.__RM_STATE__.value && !window.__RM_STATE__.valueLoading"), "database change");
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "raw", "database change resets preview mode");
  await evaluate("document.querySelector('[data-seg-value=html]').click()");
  await sleep(100);
  await evaluate("document.querySelector('[data-conn=second]').click()");
  await until(() => evaluate("window.__RM_STATE__.connId === 'second'"), "connection change");
  assert.equal(await evaluate("window.__RM_STATE__.valueMode"), "raw", "connection change resets preview mode");

  // The command prompt must remain connected while background data changes.
  await evaluate("document.querySelector('[data-nav=cli]').click()");
  await until(() => evaluate("Boolean(document.querySelector('#cli-input'))"), "CLI prompt");
  await evaluate("document.querySelector('#cli-input').focus()");
  await send("Input.insertText", { text: 'GET "pending:草稿"' });
  await evaluate("window.__keptCliInput = document.querySelector('#cli-input'); window.__keptCliInput.setSelectionRange(4, 11, 'backward'); window.__cliPollStart = window.__overviewCalls");
  const cliInputState = () => evaluate(`(() => {
    const input = document.querySelector('#cli-input');
    return {sameNode: input === window.__keptCliInput && input.isConnected, focused: document.activeElement === input,
      value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection};
  })()`);
  const pendingInput = await cliInputState();
  assert.equal(pendingInput.value, 'GET "pending:草稿"');
  await until(() => evaluate("window.__overviewCalls >= window.__cliPollStart + 2"), "two CLI polling intervals", 11000);
  assert.deepEqual(await cliInputState(), pendingInput, "polling preserves the CLI draft, connected input, focus and selection");
  assert.equal(await evaluate("document.querySelector('.statusbar').textContent.includes(String(window.__overviewCalls))"), true, "metrics continue updating while typing");
  assert.deepEqual(await evaluate("window.__cliCalls"), [], "polling never executes a pending command");

  await evaluate(`import('/src/core/store.ts').then(store => {
    store.setCliReadOnly(false);
    store.clearCliLog();
    store.toast('info', 'CLI regression notification');
    window.__RM_SETTINGS__.patch({theme: 'console', scheme: 'dark'});
  })`);
  assert.deepEqual(await cliInputState(), pendingInput, "mode, clear, notification and theme updates preserve the draft");
  await evaluate("document.querySelector('[data-fill=DBSIZE]').click()");
  await evaluate("import('/src/core/store.ts').then(store => store.loadOverview())");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "DBSIZE", "suggested commands survive refresh before execution");
  await evaluate("document.querySelector('#cli-form').requestSubmit()");
  await until(() => evaluate("document.querySelector('#cli-log').textContent.includes('result: DBSIZE')"), "CLI form result");
  assert.equal(await evaluate("window.__cliCalls.length"), 1, "form submission executes exactly once");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "submission clears the executed command");

  await evaluate("document.querySelector('#cli-input').focus()");
  await send("Input.insertText", { text: "PING" });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(() => evaluate("document.querySelector('#cli-log').textContent.includes('result: PING')"), "CLI Enter result");
  assert.equal(await evaluate("window.__cliCalls.length"), 2, "Enter executes exactly once");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "PING", "history starts with the latest command");
  await evaluate("import('/src/core/store.ts').then(store => store.loadOverview())");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "DBSIZE", "history cursor survives a background refresh");
  await evaluate("document.querySelector('#cli-form').requestSubmit()");
  await until(() => evaluate("window.__cliCalls.length === 3"), "recalled command submission");
  assert.equal(await evaluate("document.querySelector('#cli-input').dataset.hist ?? null"), null, "form submission resets history navigation");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "DBSIZE", "history restarts from the latest submitted command");

  await evaluate("window.__holdCli = true");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(() => evaluate("window.__cliCalls.length === 4 && Boolean(window.__finishCli)"), "pending CLI response");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "Enter clears the recalled command");
  assert.equal(await evaluate("document.querySelector('#cli-input').dataset.hist ?? null"), null, "Enter resets history navigation");
  await send("Input.insertText", { text: "GET next-command" });
  const nextInput = await cliInputState();
  await evaluate("window.__holdCli = false; window.__finishCli()");
  await until(() => evaluate("window.__RM_STATE__.cliSessions.second[0].lines.at(-1).lines.length > 0"), "delayed CLI result");
  assert.deepEqual(await cliInputState(), nextInput, "a previous command response preserves the next draft and focus");

  await evaluate("document.querySelector('[data-action=new-cli-session]').click()");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "new sessions do not inherit a pending command");
  await evaluate("document.querySelector('#cli-input').value = 'GET session-two'; document.querySelector('[data-cli-session=\"0\"]').click()");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "switching sessions does not carry the other session's command");
  await evaluate("document.querySelector('#cli-input').value = 'GET previous-db'; const select = document.querySelector('[data-db-select]'); select.value = '1'; select.dispatchEvent(new Event('change', {bubbles:true}))");
  await until(() => evaluate("window.__RM_STATE__.dbByConn.second === 1"), "CLI database change");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "database changes do not carry commands into another database");
  await evaluate("document.querySelector('#cli-input').value = 'GET previous-connection'; window.__RM_STATE__.pageByConn.preview = 'cli'; document.querySelector('[data-conn=preview]').click()");
  await until(() => evaluate("window.__RM_STATE__.connId === 'preview' && Boolean(document.querySelector('#cli-input'))"), "CLI connection change");
  assert.equal(await evaluate("document.querySelector('#cli-input').value"), "", "connection changes do not carry commands into another connection");
  assert.deepEqual(await evaluate("window.__cliCalls.map(({id, db, command}) => ({id, db, command}))"), [
    {id: "second", db: 0, command: "DBSIZE"}, {id: "second", db: 0, command: "PING"},
    {id: "second", db: 0, command: "DBSIZE"}, {id: "second", db: 0, command: "DBSIZE"},
  ], "only explicitly submitted commands reach the selected Redis context");

  // Application metadata and update dispatch do not depend on a Redis key.
  await evaluate("document.querySelector('[data-nav=settings]').click()");
  await until(() => evaluate("Boolean(document.querySelector('[data-action=check-updates]'))"), "update settings");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('[data-app-version]'), el => el.textContent)"), ["1.7.8", "1.7.8"], "header and settings use the running version");
  await evaluate("window.__holdUpdateCheck = true; document.querySelector('[data-action=check-updates]').click(); document.querySelector('[data-action=check-updates]').click()");
  await until(() => evaluate("window.__updateChecks === 1 && document.querySelector('[data-action=check-updates]').disabled"), "one pending update dispatch");
  await evaluate("window.__finishUpdateCheck(); window.__holdUpdateCheck = false");
  await until(() => evaluate("!document.querySelector('[data-action=check-updates]').disabled"), "update dispatch completion");
  assert.equal(await evaluate("window.__updateChecks"), 1, "repeated clicks must not dispatch duplicate native checks");
  await evaluate("window.__updateCheckError = '测试更新窗口错误'; document.querySelector('[data-action=check-updates]').click()");
  await until(() => evaluate("window.__RM_STATE__.toasts.some(toast => toast.title === '无法打开更新窗口' && toast.detail === '测试更新窗口错误')"), "update dispatch error surfaced");
  await evaluate("window.__updateCheckError = ''; window.__appInfo = {version:'1.7.9-dev', isDev:true, updatesEnabled:false}; import('/src/core/store.ts').then(store => store.loadAppInfo())");
  assert.equal(await evaluate("document.querySelector('[data-action=check-updates]').disabled"), true, "development builds disable software updates");
  assert.ok((await evaluate("document.querySelector('[data-update-status]').textContent")).includes("开发构建"));
  await evaluate("import('/src/core/store.ts').then(store => store.checkForUpdates())");
  assert.equal(await evaluate("window.__updateChecks"), 2, "disabled checks never reach the native service");
  await evaluate("window.__appInfo = {version:'1.7.9', isDev:false, updatesEnabled:false}; import('/src/core/store.ts').then(store => store.loadAppInfo())");
  assert.equal(await evaluate("document.querySelector('[data-action=check-updates]').disabled"), true, "unconfigured or non-writable installed builds do not claim update support");
  if (screenshots) {
    await evaluate("window.__appInfo = {version:'1.7.9', isDev:false, updatesEnabled:true}; import('/src/core/store.ts').then(async store => {store.patch({toasts: []}); await store.loadAppInfo()})");
    await evaluate("document.querySelector('[data-action=check-updates]').scrollIntoView({block:'center'})");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(screenshots, "update-settings.png"), Buffer.from(shot.data, "base64"));
  }

  await testRefreshState({ evaluate, send, until });

  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fixtureScript.identifier });
  await send("Page.navigate", { url: `${url}/?page=settings` });
  await until(() => evaluate("Boolean(document.querySelector('[data-action=check-updates]')) && !window.__RM_STATE__.appInfoLoading"), "ordinary browser settings");
  assert.equal(await evaluate("document.querySelector('[data-action=check-updates]').disabled"), true, "browser without a native bridge cannot check updates");
  assert.ok((await evaluate("document.querySelector('[data-update-status]').textContent")).includes("浏览器预览"));
  assert.deepEqual(exceptions, [], "no browser runtime errors");
  console.log("PASS: value previews, CLI draft/focus/history/context preservation, polling/scroll preservation, source styles, runtime version, update dispatch/errors and disabled/browser update states");
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}
