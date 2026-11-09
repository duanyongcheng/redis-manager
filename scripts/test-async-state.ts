/** Store regressions for delayed Redis replies. Uses only an in-memory service.
 * Run: bun scripts/test-async-state.ts
 */
import assert from "node:assert/strict";
import type { Connection, KeyPage, OverviewSnapshot, RedisValue, Service } from "../src/core/api";
import type { KeyTarget } from "../src/core/store";

type MockRedis = Pick<Service, "listConnections" | "saveConnection" | "getOverview" | "scanKeys" | "getValue" | "hashSet" | "deleteKey">;
const connections: Connection[] = ["a", "b"].map((id) => ({
  id, name: id, group: "Local", host: "localhost", port: 6379, db: 0, mode: "standalone", tls: false, readOnly: false,
}));
const overview = (): OverviewSnapshot => ({
  atMs: 1, opsPerSec: 0, connectedClients: 1, usedMemoryBytes: 1, maxMemoryBytes: 1, latencyMs: 1,
  totalKeys: 0, keyspaces: [], commands: [], info: { redis_version: "test" },
});
const value = (key: string, source = key): RedisValue => ({
  key, type: "hash", hash: { source }, ttlMs: -1, sizeBytes: 1, encoding: "test",
});
const page = (keys: string[], cursor = 0): KeyPage => ({
  keys: keys.map((key) => ({ key, type: "hash", ttlMs: -1, sizeBytes: 1, encoding: "test" })),
  cursor, done: cursor === 0,
});
const defaults = (): MockRedis => ({
  listConnections: async () => connections.map((conn) => ({ ...conn })),
  saveConnection: async () => {},
  getOverview: async () => overview(),
  scanKeys: async () => page([]),
  getValue: async (id, db, key) => value(key, `${id}/${db}`),
  hashSet: async () => {},
  deleteKey: async () => {},
});
const service = defaults();

// No DOM rendering or real timers are needed for these store-level checks.
Object.assign(globalThis, {
  window: { RedisService: service, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {} },
  document: { hidden: false, documentElement: { dataset: {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
});
const store = await import("../src/core/store");
const { state } = store;
const initialState = structuredClone(state);
const pending = new Set<{ reject: (error: Error) => void }>();
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  const result = {
    promise,
    resolve(result: T) { pending.delete(handle); resolvePromise(result); },
    reject(error: Error) { pending.delete(handle); rejectPromise(error); },
  };
  const handle = { reject: result.reject };
  pending.add(handle);
  // Cleanup also settles an unused fixture after an earlier assertion fails.
  void promise.catch(() => {});
  return result;
}

async function reset() {
  Object.assign(service, defaults());
  Object.assign(state, structuredClone(initialState), {
    connections: connections.map((conn) => ({ ...conn, status: "on", version: "test", latencyMs: 1 })),
    pageByConn: { a: "browser", b: "browser" },
  });
  await store.selectConnection("a");
  await drain();
}

let passed = 0;
let failed = 0;
async function test(name: string, body: () => Promise<void>) {
  await reset();
  try {
    await body();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error);
  } finally {
    for (const task of [...pending]) task.reject(new Error("Test fixture cleanup"));
    await drain();
  }
}

type Boundary = "connection" | "database";
async function switchAway(boundary: Boundary) {
  if (boundary === "connection") await store.selectConnection("b");
  else await store.selectDatabase(1);
}
async function switchBack(boundary: Boundary) {
  if (boundary === "connection") await store.selectConnection("a");
  else await store.selectDatabase(0);
}

await test("a failed old read cannot erase the newly selected value", async () => {
  await store.openKey("initial");
  const old = deferred<RedisValue>();
  service.getValue = async (_id, _db, key) => key === "old" ? old.promise : value(key);
  const reading = store.openKey("old");
  assert.equal(state.value, null, "switching keys hides the previous editable value while loading");
  await store.openKey("new");
  old.reject(new Error("old read failed"));
  await reading;
  assert.equal(state.selectedKey, "new");
  assert.equal(state.value?.key, "new");
  assert.equal(state.valueError, "");
  assert.equal(state.valueLoading, false);
});

for (const outcome of ["success", "error"] as const) {
  await test(`an old read ${outcome} cannot finish a newer pending read`, async () => {
    const old = deferred<RedisValue>();
    const current = deferred<RedisValue>();
    service.getValue = async (_id, _db, key) => key === "old" ? old.promise : current.promise;
    const oldRead = store.openKey("old");
    const newRead = store.openKey("new");
    if (outcome === "success") old.resolve(value("old"));
    else old.reject(new Error("old read failed"));
    await oldRead;
    assert.equal(state.selectedKey, "new");
    assert.equal(state.value, null);
    assert.equal(state.valueError, "");
    assert.equal(state.valueLoading, true, "the current request still owns the loading indicator");
    current.resolve(value("new"));
    await newRead;
    assert.equal(state.value?.key, "new");
    assert.equal(state.valueLoading, false);
  });
}

await test("repeated reads of the same key keep the newest response", async () => {
  const old = deferred<RedisValue>();
  const current = deferred<RedisValue>();
  let reads = 0;
  service.getValue = async () => ++reads === 1 ? old.promise : current.promise;
  const first = store.openKey("same");
  const second = store.openKey("same");
  current.resolve(value("same", "newest"));
  await second;
  old.resolve(value("same", "outdated"));
  await first;
  assert.equal(state.value?.hash?.source, "newest");
});

for (const boundary of ["connection", "database"] as const) {
  await test(`a read from an earlier ${boundary} visit stays stale after returning`, async () => {
    const old = deferred<RedisValue>();
    service.getValue = async () => old.promise;
    const reading = store.openKey("same");
    await switchAway(boundary);
    await switchBack(boundary);
    await drain();
    service.getValue = async () => value("same", "current visit");
    await store.openKey("same");
    old.resolve(value("same", "previous visit"));
    await reading;
    assert.equal(state.value?.hash?.source, "current visit");
  });
}

for (const boundary of ["connection", "database"] as const) {
  for (const outcome of ["success", "error"] as const) {
    await test(`old SCAN ${outcome} does not affect a pending scan after a ${boundary} switch`, async () => {
      const old = deferred<KeyPage>();
      const current = deferred<KeyPage>();
      const calls: { id: string; db: number }[] = [];
      service.scanKeys = async (id, db) => {
        calls.push({ id, db });
        return calls.length === 1 ? old.promise : current.promise;
      };
      const oldScan = store.scanKeys({ reset: true });
      await switchAway(boundary);
      assert.equal(calls.length, 2, "switching starts the new target scan before the old one finishes");
      assert.deepEqual(calls[1], boundary === "connection" ? { id: "b", db: 0 } : { id: "a", db: 1 });
      if (outcome === "success") old.resolve(page(["old:key"]));
      else old.reject(new Error("old scan failed"));
      await oldScan;
      assert.equal(state.scanning, true);
      assert.equal(state.keyDone, false);
      assert.equal(state.keyCursor, 0);
      assert.equal(state.keyScanned, 0);
      assert.deepEqual(state.keys, []);
      assert.equal(state.toasts.some((toast) => toast.title === "SCAN 失败"), false);
      current.resolve(page(["new:key"]));
      await drain();
      assert.equal(state.scanning, false);
      assert.deepEqual(state.keys.map((key) => key.key), ["new:key"]);
      assert.equal(state.value?.key, "new:key");
    });
  }
  for (const outcome of ["success", "error"] as const) {
    await test(`old SCAN ${outcome} stays stale after leaving and returning to a ${boundary}`, async () => {
      const old = deferred<KeyPage>();
      let scans = 0;
      service.scanKeys = async () => ++scans === 1 ? old.promise : page(scans === 3 ? ["current:key"] : []);
      const oldScan = store.scanKeys({ reset: true });
      await switchAway(boundary);
      await switchBack(boundary);
      await drain();
      assert.equal(scans, 3);
      if (outcome === "success") old.resolve(page(["outdated:key"], 99));
      else old.reject(new Error("previous visit scan failed"));
      await oldScan;
      assert.deepEqual(state.keys.map((key) => key.key), ["current:key"]);
      assert.equal(state.value?.key, "current:key");
      assert.equal(state.keyCursor, 0);
      assert.equal(state.scanning, false);
      assert.equal(state.toasts.some((toast) => toast.title === "SCAN 失败"), false);
    });
  }
}

await test("reset replaces the old pattern results and append merges without duplicates", async () => {
  const calls: { pattern: string; cursor: number }[] = [];
  service.scanKeys = async (_id, _db, pattern, cursor) => {
    calls.push({ pattern, cursor });
    return pattern === "old:*" ? page(["old:one"]) : cursor === 0 ? page(["new:one"], 7) : page(["new:one", "new:two", "new:two"]);
  };
  state.keyPattern = "old:*";
  await store.scanKeys({ reset: true });
  await drain();
  state.keyPattern = "new:*";
  await store.scanKeys({ reset: true });
  await drain();
  assert.deepEqual(state.keys.map((key) => key.key), ["new:one"]);
  assert.equal(state.selectedKey, "new:one");
  assert.equal(state.value?.key, "new:one");
  assert.equal(state.keyDone, false);
  await store.scanKeys({ append: true });
  assert.deepEqual(state.keys.map((key) => key.key), ["new:one", "new:two"]);
  assert.deepEqual(calls, [{ pattern: "old:*", cursor: 0 }, { pattern: "new:*", cursor: 0 }, { pattern: "new:*", cursor: 7 }]);
  assert.equal(state.keyDone, true);
  service.scanKeys = async () => page([]);
  await store.scanKeys({ reset: true });
  assert.deepEqual(state.keys, []);
  assert.equal(state.selectedKey, null);
  assert.equal(state.value, null);
});

await test("a reset for a new pattern supersedes an in-flight scan", async () => {
  const old = deferred<KeyPage>();
  service.scanKeys = async (_id, _db, pattern) => pattern === "old:*" ? old.promise : page(["new:one"]);
  state.keyPattern = "old:*";
  const oldScan = store.scanKeys({ reset: true });
  state.keyPattern = "new:*";
  await store.scanKeys({ reset: true });
  old.resolve(page(["old:one"]));
  await oldScan;
  await drain();
  assert.deepEqual(state.keys.map((key) => key.key), ["new:one"]);
  assert.equal(state.selectedKey, "new:one");
});

for (const destination of ["key", "connection", "database"] as const) {
  await test(`a delayed Hash write cannot replace the newly selected ${destination}`, async () => {
    const write = deferred<void>();
    service.hashSet = async () => write.promise;
    await store.openKey("shared");
    const saving = store.saveHashField("oldField", "oldValue");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await drain();
      await store.openKey("shared");
    }
    const expected = structuredClone(state.value);
    write.resolve();
    assert.equal(await saving, true, "successful writes remain successful even after navigation");
    assert.deepEqual(state.value, expected);
    assert.equal(state.selectedKey, expected?.key);
  });

  await test(`a delayed Hash write stays stale after leaving and returning to the same ${destination}`, async () => {
    const write = deferred<void>();
    service.hashSet = async () => write.promise;
    await store.openKey("shared");
    const saving = store.saveHashField("oldField", "oldValue");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await switchBack(destination);
      await drain();
    }
    service.getValue = async () => value("shared", "current visit");
    await store.openKey("shared");
    write.resolve();
    await saving;
    assert.deepEqual(state.value?.hash, { source: "current visit" });
  });
}

await test("concurrent Hash writes to different fields merge in completion order", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  service.hashSet = async (_id, _db, _key, field) => field === "first" ? first.promise : second.promise;
  await store.openKey("shared");
  const firstWrite = store.saveHashField("first", "one");
  const secondWrite = store.saveHashField("second", "two");
  second.resolve();
  await secondWrite;
  first.resolve();
  await firstWrite;
  assert.deepEqual(state.value?.hash, { source: "a/0", first: "one", second: "two" });
});

await test("a successful Hash write is not overwritten by an earlier pending read", async () => {
  await store.openKey("shared");
  const old = deferred<RedisValue>();
  service.getValue = async () => old.promise;
  const reading = store.openKey("shared");
  assert.equal(await store.saveHashField("saved", "latest"), true);
  old.resolve(value("shared", "outdated snapshot"));
  await reading;
  assert.deepEqual(state.value?.hash, { source: "a/0", saved: "latest" });
  assert.equal(state.valueLoading, false);
});

await test("deleting the current key clears its value and removes only that key", async () => {
  const deleted: KeyTarget[] = [];
  service.deleteKey = async (connId, db, key) => { deleted.push({ connId, db, key }); };
  state.keys = page(["current", "other"]).keys;
  await store.openKey("current");
  await store.deleteSelectedKey();
  assert.deepEqual(deleted, [{ connId: "a", db: 0, key: "current" }]);
  assert.equal(state.selectedKey, null);
  assert.equal(state.value, null);
  assert.deepEqual(state.keys.map((key) => key.key), ["other"]);
});

for (const destination of ["key", "connection", "database"] as const) {
  await test(`a delayed delete cannot clear the newly selected ${destination}`, async () => {
    const deletion = deferred<void>();
    service.deleteKey = async () => deletion.promise;
    await store.openKey("old");
    const deleting = store.deleteSelectedKey();
    if (destination !== "key") {
      await switchAway(destination);
      await drain();
    }
    await store.openKey("current");
    state.keys = page(["current"]).keys;
    const expected = structuredClone(state.value);
    deletion.resolve();
    await deleting;
    assert.equal(state.selectedKey, "current");
    assert.deepEqual(state.value, expected);
    assert.deepEqual(state.keys.map((key) => key.key), ["current"]);
  });
}

for (const boundary of ["connection", "database"] as const) {
  await test(`a delayed delete cannot remove a same-named key after returning to a ${boundary}`, async () => {
    const deletion = deferred<void>();
    service.deleteKey = async () => deletion.promise;
    await store.openKey("shared");
    const deleting = store.deleteSelectedKey();
    await switchAway(boundary);
    await switchBack(boundary);
    await drain();
    await store.openKey("shared");
    state.keys = page(["shared"]).keys;
    deletion.resolve();
    await deleting;
    assert.equal(state.selectedKey, "shared");
    assert.equal(state.value?.key, "shared");
    assert.deepEqual(state.keys.map((key) => key.key), ["shared"]);
  });
}

await test("an explicit delete target fixes the connection, database and key at confirmation time", async () => {
  const deleted: KeyTarget[] = [];
  service.deleteKey = async (connId, db, key) => { deleted.push({ connId, db, key }); };
  await store.openKey("confirmed");
  const confirmed: KeyTarget = { connId: "a", db: 0, key: "confirmed" };
  await store.selectConnection("b");
  await store.selectDatabase(3);
  await drain();
  await store.openKey("current");
  await store.deleteSelectedKey(confirmed);
  assert.deepEqual(deleted, [confirmed]);
  assert.equal(state.connId, "b");
  assert.equal(store.currentDb(), 3);
  assert.equal(state.selectedKey, "current");
  assert.equal(state.value?.key, "current");
});

await test("an old connection save does not close a newly opened editor for the same connection", async () => {
  const save = deferred<void>();
  service.saveConnection = async () => save.promise;
  state.connectionEditor = { mode: "edit", id: "a" };
  const saving = store.saveConnection(connections[0]!, "");
  state.connectionEditor = null;
  const newEditor = { mode: "edit" as const, id: "a" };
  state.connectionEditor = newEditor;
  save.resolve();
  assert.equal(await saving, true);
  assert.equal(state.connectionEditor, newEditor, "editor identity matters even when the edited connection is unchanged");
});

await test("an old connection save does not change the selection or close another editor", async () => {
  const save = deferred<void>();
  service.saveConnection = async () => save.promise;
  state.connectionEditor = { mode: "edit", id: "a" };
  const saving = store.saveConnection(connections[0]!, "");
  await store.selectConnection("b");
  await drain();
  const newEditor = { mode: "edit" as const, id: "b" };
  state.connectionEditor = newEditor;
  save.resolve();
  assert.equal(await saving, true);
  assert.equal(state.connId, "b");
  assert.equal(state.connectionEditor, newEditor);
});

await test("saving from the current editor still closes it and selects the saved connection", async () => {
  state.connectionEditor = { mode: "edit", id: "b" };
  assert.equal(await store.saveConnection(connections[1]!, ""), true);
  assert.equal(state.connectionEditor, null);
  assert.equal(state.connId, "b");
});

console.log(`Async state regressions: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
