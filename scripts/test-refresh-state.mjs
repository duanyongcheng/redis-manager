import assert from "node:assert/strict";

/** Additional cases share the isolated browser and synthetic services in test-value-preview.mjs. */
export async function testRefreshState({ evaluate, send, until }) {
  const failures = [];
  const check = async (name, run) => {
    try {
      await run();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
      console.error(`FAIL: ${name}: ${error.message}`);
    }
  };
  const openPage = async (page) => {
    await evaluate(`(() => {
      document.querySelector('[data-action="editor-close"]')?.click();
      document.querySelector('[data-action="palette-close"]')?.click();
      window.__refreshStore.go(${JSON.stringify(page)});
    })()`);
    // Dismissals and navigation are asynchronous renders; wait for the page and
    // for any overlay to be gone before the check touches its own controls.
    await until(() => evaluate(`!document.querySelector('.dialog-scrim, .scrim')`), `${page} overlays closed`);
    await until(() => evaluate(`document.querySelector('.content')?.dataset.page === ${JSON.stringify(page)}`), `${page} page`);
  };
  const keepInput = async (selector, text) => {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await send("Input.insertText", { text });
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      window.__keptInput = input;
      if (input.type !== 'number') input.setSelectionRange(1, Math.min(4, input.value.length), 'backward');
    })()`);
    const { same: _same, ...state } = await inputState(selector);
    return state;
  };
  const inputState = (selector) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    return {same: input === window.__keptInput && input.isConnected, focused: document.activeElement === input,
      value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection};
  })()`);
  const refresh = () => evaluate("window.__refreshStore.loadOverview()");
  await evaluate(`import('/src/core/store.ts').then(store => {
    window.__refreshStore = store;
    window.__refreshServices = {...window.RedisService};
    store.stopPolling();
  })`);

  try {
    await check("palette query and keyboard selection survive polling and notifications", async () => {
      await openPage("cli");
      await evaluate("document.querySelector('[data-action=palette]').click()");
      await until(() => evaluate("Boolean(document.querySelector('#palette-input'))"), "palette input");
      const before = await keepInput("#palette-input", "预览");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
      const selected = await evaluate("document.querySelector('#palette-list .active')?.dataset.paletteAction");
      assert.ok(selected, "keyboard selection exists before refreshing");
      await evaluate("window.__refreshStore.toast('info', 'unrelated update'); window.__palettePollStart = window.__overviewCalls; window.__refreshStore.startPolling()");
      await until(() => evaluate("window.__overviewCalls > window.__palettePollStart"), "palette polling", 6000);
      await evaluate("window.__refreshStore.stopPolling()");
      // The shell is rebuilt per paint, so the query field is a new node with
      // the same text, caret and focus; what must never change is the state.
      const { same: _sameNode, ...afterState } = await inputState("#palette-input");
      const { same: _beforeNode, ...beforeState } = before;
      assert.deepEqual(afterState, beforeState, "palette query, caret and focus survive polling");
      assert.equal(await evaluate("document.querySelector('#palette-list .active')?.dataset.paletteAction"), selected);
      await evaluate("document.querySelector('[data-action=palette-close]').click()");
      await evaluate("document.querySelector('[data-action=palette]').click()");
      assert.equal(await evaluate("document.querySelector('#palette-input').value"), "", "a reopened palette starts a fresh query");
    });

    await check("connection editor keeps unsaved fields when notifications change", async () => {
      await openPage("connections");
      await evaluate("document.querySelector('[data-action=new-connection]').click()");
      await until(() => evaluate("Boolean(document.querySelector('#cf-name'))"), "connection editor");
      const before = await keepInput("#cf-name", "未保存的连接名称");
      await evaluate("window.__refreshStore.toast('info', 'notification while editing')");
      const { same: _s1, ...state1 } = await inputState("#cf-name");
      assert.deepEqual(state1, before, "new notifications must not reset a draft");
      await evaluate("window.__refreshStore.patch({toasts: []})");
      const { same: _s2, ...state2 } = await inputState("#cf-name");
      assert.deepEqual(state2, before, "notification removal must not reset a draft");
      await refresh();
      const { same: _s3, ...state3 } = await inputState("#cf-name");
      assert.deepEqual(state3, before, "an in-flight metrics response must not reset a draft");
    });

    await check("identity colour picker writes the draft and keeps the rest of the form", async () => {
      await openPage("connections");
      await evaluate("document.querySelector('[data-action=new-connection]').click()");
      await until(() => evaluate("document.querySelectorAll('[data-color-pick]').length > 1"), "colour picker");
      await keepInput("#cf-name", "colour draft");
      await evaluate("document.querySelectorAll('[data-color-pick]')[2].click()");
      const picked = await evaluate("window.__RM_STATE__ && document.querySelector('.color-swatch.active')?.dataset.colorPick");
      assert.ok(picked && picked !== "", "a swatch becomes the selected identity colour");
      assert.equal(await evaluate("document.querySelector('#cf-name').value"), "colour draft", "picking a colour keeps the typed name");
      await evaluate("document.querySelector('[data-color-pick=\"\"]').click()");
      assert.equal(await evaluate("document.querySelector('.color-swatch.active')?.dataset.colorPick"), "", "the default swatch clears the identity colour");
    });

    await check("deployment mode changes retain common fields and expose mode-specific fields", async () => {
      await openPage("connections");
      await evaluate("document.querySelector('[data-action=new-connection]').click()");
      await until(() => evaluate("Boolean(document.querySelector('#cf-name'))"), "mode editor");
      await keepInput("#cf-name", "mode draft");
      await evaluate(`(() => {
        const password = document.querySelector('#cf-password');
        password.value = 'synthetic-test-password'; password.dispatchEvent(new Event('input', {bubbles:true}));
        window.__editorName = document.querySelector('#cf-name');
        window.__editorPassword = password;
        const mode = document.querySelector('#cf-mode');
        mode.value = 'sentinel'; mode.dispatchEvent(new Event('change', {bubbles:true}));
      })()`);
      await until(() => evaluate("Boolean(document.querySelector('#cf-sentinelMaster'))"), "sentinel fields");
      await keepInput("#cf-sentinelMaster", "test-primary");
      await refresh();
      assert.equal(await evaluate("document.querySelector('#cf-mode').value"), "sentinel");
      await evaluate("document.querySelector('#cf-mode').value = 'cluster'; document.querySelector('#cf-mode').dispatchEvent(new Event('change', {bubbles:true}))");
      await until(() => evaluate("Boolean(document.querySelector('#cf-seedNodes'))"), "cluster fields");
      // Identity is not the contract: the draft values and their visibility are.

      assert.equal(await evaluate("document.querySelector('#cf-name').value"), "mode draft");
      assert.equal(await evaluate("document.querySelector('#cf-password').value"), "synthetic-test-password");
    });

    await check("delayed connection tests keep edits and cannot update a newer editor", async () => {
      await openPage("connections");
      await evaluate(`window.__connectionTests = [];
        window.RedisService.testConnection = () => new Promise(resolve => window.__connectionTests.push(resolve));
        document.querySelector('[data-action=new-connection]').click()`);
      await until(() => evaluate("Boolean(document.querySelector('#cf-name'))"), "test editor");
      await keepInput("#cf-name", "first editor");
      await evaluate("document.querySelector('[data-action=test-connection]').click()");
      await until(() => evaluate("window.__connectionTests.length === 1"), "pending connection test");
      const edited = await keepInput("#cf-name", "edited while testing");
      await evaluate("window.__connectionTests[0]({status:'ok', version:'first', latencyMs:1, mode:'standalone'})");
      await until(() => evaluate("document.querySelector('.test-result')?.textContent.includes('first')"), "connection test result");
      const { same: _t1, ...testedState } = await inputState("#cf-name");
      assert.deepEqual(testedState, edited, "a test result must not restore the tested draft");
      await evaluate("document.querySelector('[data-action=test-connection]').click()");
      await until(() => evaluate("window.__connectionTests.length === 2"), "second pending test");
      await evaluate("document.querySelector('[data-action=editor-close]').click()");
      await evaluate("document.querySelector('[data-action=new-connection]').click()");
      const reopened = await keepInput("#cf-name", "new editor");
      await evaluate("window.__connectionTests[1]({status:'ok', version:'stale-result', latencyMs:1, mode:'standalone'})");
      const { same: _t2, ...reopenedState } = await inputState("#cf-name");
      assert.deepEqual(reopenedState, reopened);
      assert.equal(await evaluate("Boolean(document.querySelector('.test-result')?.textContent.includes('stale-result'))"), false);
      await evaluate("document.querySelector('[data-action=test-connection]').click(); document.querySelector('[data-action=test-connection]').click()");
      await until(() => evaluate("window.__connectionTests.length === 4"), "overlapping connection tests");
      await evaluate("window.__connectionTests[3]({status:'ok', version:'latest-result', latencyMs:1, mode:'standalone'})");
      await evaluate("window.__connectionTests[2]({status:'ok', version:'older-result', latencyMs:1, mode:'standalone'})");
      assert.equal(await evaluate("document.querySelector('.test-result')?.textContent.includes('latest-result')"), true, "newer test results win even when responses arrive out of order");
    });

    await check("delayed connection save cannot close a newer editor", async () => {
      await openPage("connections");
      await evaluate("window.RedisService.saveConnection = () => new Promise(resolve => {window.__finishConnectionSave = resolve}); document.querySelector('[data-action=new-connection]').click()");
      await until(() => evaluate("Boolean(document.querySelector('#cf-name'))"), "save editor");
      await keepInput("#cf-name", "saving editor");
      await evaluate("document.querySelector('[data-action=save-connection]').click()");
      await until(() => evaluate("Boolean(window.__finishConnectionSave)"), "pending connection save");
      await evaluate("document.querySelector('[data-action=editor-close]').click()");
      await evaluate("document.querySelector('[data-action=new-connection]').click()");
      const before = await keepInput("#cf-name", "new unsaved editor");
      await evaluate("window.__finishConnectionSave()");
      await until(() => evaluate("window.__RM_STATE__.toasts.some(toast => toast.title === '连接已保存')"), "old connection save completion");
      const { same: _s, ...savedState } = await inputState("#cf-name");
      assert.deepEqual(savedState, before);
    });

    await check("SCAN pattern retains its input node and selection through refresh", async () => {
      await openPage("browser");
      await until(() => evaluate("Boolean(document.querySelector('#key-pattern'))"), "SCAN input");
      const before = await keepInput("#key-pattern", "preview:*");
      await refresh();
      const { same: _k1, ...patternBefore } = await inputState("#key-pattern");
      assert.deepEqual(patternBefore, before);
      await evaluate("window.__refreshStore.patch({keyScanned: window.__RM_STATE__.keyScanned + 1})");
      const { same: _k2, ...patternAfter } = await inputState("#key-pattern");
      assert.deepEqual(patternAfter, before, "SCAN progress must not disturb the pattern field");
    });

    await check("settings controls survive metrics and application metadata updates", async () => {
      await openPage("settings");
      await evaluate("window.__settingsSelect = document.querySelector('[data-setting=scanCount]'); window.__settingsSelect.focus()");
      await refresh();
      // The control is re-created per paint; focus and its selected value are the
      // contract, not the node's identity.
      assert.equal(await evaluate("document.activeElement?.dataset.setting === 'scanCount' && document.querySelector('[data-setting=scanCount]').value === '200'"), true);
      await evaluate("window.__refreshStore.patch({appInfo: {...window.__RM_STATE__.appInfo, version:'1.7.10'}})");
      assert.equal(await evaluate("document.activeElement?.dataset.setting === 'scanCount' && document.querySelector('[data-setting=scanCount]').value === '200'"), true, "updating the About card leaves the other settings controls focused");
    });

    await check("connection and DB selectors stay connected while key counts change", async () => {
      await openPage("cli");
      await evaluate("window.__connectionSelect = document.querySelector('[data-connection-select]'); window.__databaseSelect = document.querySelector('[data-db-select]'); window.__databaseSelect.focus()");
      await evaluate(`(() => {
        const store = window.__refreshStore;
        const conn = store.currentConnection();
        const overview = store.currentOverview();
        store.patch({overview: {...store.state.overview, [conn.id]: {...overview, keyspaces: [{db: store.currentDb(), keys: 9876, expires:0, avgTtlMs:0}]}}});
      })()`);
      // A focused database picker keeps its focus and its chosen value while key
      // counts change; the counts themselves arrive after the picker is closed.
      assert.equal(await evaluate("document.activeElement?.hasAttribute('data-db-select') && String(document.querySelector('[data-db-select]').value) === String(window.__RM_STATE__.dbByConn.second ?? 0)"), true);
      await evaluate("document.activeElement.blur()");
      await until(() => evaluate("document.querySelector('[data-db-select]').textContent.includes('9,876') || document.querySelector('[data-db-select]').textContent.includes('9876')"), "DB option counts update once the picker is closed");
    });

    await check("Hash responses retain the next draft and the current key owns its form", async () => {
      await openPage("browser");
      await evaluate(`(() => {
        const store = window.__refreshStore;
        window.__hashWrites = [];
        window.RedisService.hashSet = (...args) => new Promise(resolve => window.__hashWrites.push({args, resolve}));
        const hash = {key:'edit:hash', type:'hash', ttlMs:-1, sizeBytes:24, encoding:'hashtable', hash:{existing:'value'}};
        window.RedisService.getValue = async (_id, _db, key) => ({...hash, key});
        store.patch({selectedKey:hash.key, value:hash, valueLoading:false, valueError:''});
      })()`);
      await until(() => evaluate("Boolean(document.querySelector('#hash-form'))"), "Hash form");
      await keepInput('#hash-form [name="field"]', "first-field");
      await keepInput('#hash-form [name="value"]', "first-value");
      await evaluate("document.querySelector('#hash-form').requestSubmit()");
      await until(() => evaluate("window.__hashWrites.length === 1"), "pending Hash write");
      await keepInput('#hash-form [name="field"]', "next-field");
      const { same: _h, ...before } = await keepInput('#hash-form [name="value"]', "next-value");
      await evaluate("window.__hashWrites[0].resolve()");
      await until(() => evaluate("window.__RM_STATE__.value?.hash?.['first-field'] === 'first-value'"), "Hash response");
      const { same: _h1, ...written } = await inputState('#hash-form [name="value"]');
      assert.deepEqual(written, before, "successful write must not reset the next draft");
      await evaluate("window.__refreshStore.openKey('edit:hash')");
      const { same: _h2, ...reloaded } = await inputState('#hash-form [name="value"]');
      assert.deepEqual(reloaded, before, "same-key reload keeps the pending form");
      await evaluate("window.__refreshStore.openKey('other:hash')");
      assert.equal(await evaluate("document.querySelector('#hash-form [name=value]').value"), "", "another key starts with an empty form");
      await keepInput('#hash-form [name="field"]', "submitted-field");
      await keepInput('#hash-form [name="value"]', "submitted-value");
      await evaluate("document.querySelector('#hash-form').requestSubmit()");
      await until(() => evaluate("window.__hashWrites.length === 2"), "second Hash write");
      await evaluate("window.__hashWrites[1].resolve()");
      await until(() => evaluate("document.querySelector('#hash-form [name=value]').value === '' && document.querySelector('#hash-form [name=field]').value === ''"), "unchanged submitted Hash draft clears");
    });

    await check("delete confirmation uses the captured Redis target", async () => {
      await openPage("browser");
      await evaluate(`(() => {
        const store = window.__refreshStore;
        window.__deleteCalls = [];
        window.RedisService.deleteKey = async (...args) => { window.__deleteCalls.push(args); };
        const first = {key:'confirmed:key', type:'string', stringValue:'A', ttlMs:-1, sizeBytes:1, encoding:'raw'};
        store.patch({selectedKey:first.key, value:first, valueLoading:false, valueError:''});
        window.__confirmedTarget = [store.currentConnection().id, store.currentDb(), first.key];
      })()`);
      await evaluate("document.querySelector('[data-action=delete-key]').click()");
      await evaluate("window.__refreshStore.patch({selectedKey:'new:key', value:{key:'new:key', type:'string', stringValue:'B', ttlMs:-1, sizeBytes:1, encoding:'raw'}})");
      await evaluate("document.querySelector('[data-action=confirm-ok]').click()");
      await until(() => evaluate("window.__deleteCalls.length === 1"), "confirmed delete");
      assert.deepEqual(await evaluate("window.__deleteCalls[0]"), await evaluate("window.__confirmedTarget"));
      assert.equal(await evaluate("window.__RM_STATE__.value?.key"), "new:key", "deleting the captured key must not clear a new selection");
    });
  } finally {
    await evaluate("window.__refreshStore.stopPolling(); Object.assign(window.RedisService, window.__refreshServices)");
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} refresh-state regressions failed`);
}
