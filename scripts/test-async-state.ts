/** Store regressions for delayed Redis replies. Uses only an in-memory service.
 * Run: bun scripts/test-async-state.ts
 */
import assert from "node:assert/strict";
import type { Connection, KeyPage, OverviewSnapshot, RedisValue, Service } from "../src/core/api";
import type { KeyTarget } from "../src/core/store";

type MockRedis = Pick<
  Service,
  "listConnections" | "saveConnection" | "getOverview" | "scanKeys" | "getValue" | "hashSet" | "hashDelete" | "setTTL" | "setString" | "deleteKey" | "execCLI"
> &
  Partial<Pick<Service, "getCredentialStorage" | "setCredentialStorage">>;
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
const stringVal = (key: string, text = key, ttlMs = -1): RedisValue => ({
  key, type: "string", stringValue: text, ttlMs, sizeBytes: text.length, totalCount: text.length, encoding: "raw",
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
  hashDelete: async () => {},
  setTTL: async () => {},
  setString: async () => {},
  deleteKey: async () => {},
  execCLI: async () => ({ lines: [], durationMs: 1 }),
  getCredentialStorage: undefined,
  setCredentialStorage: undefined,
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

await test("credential storage mode loads, switches, and keeps state on failure", async () => {
  service.getCredentialStorage = async () => ({ mode: "local", keychainPending: 2 });
  await store.loadCredentialStorage();
  assert.equal(state.credentialStorage, "local");
  assert.equal(state.credentialKeychainPending, 2);

  service.setCredentialStorage = async (mode) => ({ mode, keychainPending: 0 });
  assert.equal(await store.setCredentialStorage("keychain"), true);
  assert.equal(state.credentialStorage, "keychain");
  assert.equal(state.credentialKeychainPending, 0);
  assert.equal(state.credentialStorageSaving, false);

  service.setCredentialStorage = async () => {
    throw new Error("keychain denied");
  };
  assert.equal(await store.setCredentialStorage("local"), false);
  assert.equal(state.credentialStorage, "keychain");
  assert.equal(state.credentialStorageSaving, false);
  assert.equal(state.toasts.some((t) => t.title === "切换密码存储失败"), true);
});

for (const destination of ["key", "connection", "database"] as const) {
  await test(`a delayed saveKeyTtl cannot overwrite the newly selected ${destination}`, async () => {
    const ttlWrite = deferred<void>();
    service.setTTL = async () => ttlWrite.promise;
    await store.openKey("shared");
    const saving = store.saveKeyTtl(120);
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await drain();
      await store.openKey("shared");
    }
    const expected = structuredClone(state.value);
    ttlWrite.resolve();
    assert.equal(await saving, true);
    assert.deepEqual(state.value, expected);
    assert.equal(state.selectedKey, expected?.key);
  });

  await test(`a delayed saveKeyTtl stays stale after leaving and returning to the same ${destination}`, async () => {
    const ttlWrite = deferred<void>();
    service.setTTL = async () => ttlWrite.promise;
    await store.openKey("shared");
    const saving = store.saveKeyTtl(120);
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await switchBack(destination);
      await drain();
    }
    service.getValue = async () => ({ ...value("shared", "current visit"), ttlMs: 30_000 });
    await store.openKey("shared");
    ttlWrite.resolve();
    await saving;
    assert.equal(state.value?.ttlMs, 30_000);
  });

  await test(`a delayed saveStringValue cannot overwrite the newly selected ${destination}`, async () => {
    const strWrite = deferred<void>();
    service.getValue = async (id, db, key) => stringVal(key, `${id}/${db}:${key}`);
    service.setString = async () => strWrite.promise;
    await store.openKey("shared");
    const saving = store.saveStringValue("stale-string-value");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await drain();
      await store.openKey("shared");
    }
    const expected = structuredClone(state.value);
    strWrite.resolve();
    assert.equal(await saving, true);
    assert.deepEqual(state.value, expected);
    assert.equal(state.selectedKey, expected?.key);
  });

  await test(`a delayed saveStringValue stays stale after leaving and returning to the same ${destination}`, async () => {
    const strWrite = deferred<void>();
    service.getValue = async (id, db, key) => stringVal(key, `${id}/${db}:${key}`);
    service.setString = async () => strWrite.promise;
    await store.openKey("shared");
    const saving = store.saveStringValue("stale-string-value");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await switchBack(destination);
      await drain();
    }
    service.getValue = async () => stringVal("shared", "current string visit");
    await store.openKey("shared");
    strWrite.resolve();
    await saving;
    assert.equal(state.value?.stringValue, "current string visit");
  });

  await test(`a delayed removeHashField cannot overwrite the newly selected ${destination}`, async () => {
    const hashDel = deferred<void>();
    service.getValue = async (id, db, key) => ({
      key, type: "hash", hash: { source: `${id}/${db}`, keep: "yes" }, totalCount: 2, ttlMs: -1, sizeBytes: 8, encoding: "hashtable",
    });
    service.hashDelete = async () => hashDel.promise;
    await store.openKey("shared");
    const removing = store.removeHashField("source");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await drain();
      await store.openKey("shared");
    }
    const expected = structuredClone(state.value);
    hashDel.resolve();
    assert.equal(await removing, true);
    assert.deepEqual(state.value, expected);
    assert.equal(state.selectedKey, expected?.key);
  });

  await test(`a delayed removeHashField stays stale after leaving and returning to the same ${destination}`, async () => {
    const hashDel = deferred<void>();
    service.getValue = async (id, db, key) => ({
      key, type: "hash", hash: { source: `${id}/${db}`, keep: "yes" }, totalCount: 2, ttlMs: -1, sizeBytes: 8, encoding: "hashtable",
    });
    service.hashDelete = async () => hashDel.promise;
    await store.openKey("shared");
    const removing = store.removeHashField("source");
    if (destination === "key") await store.openKey("other");
    else {
      await switchAway(destination);
      await switchBack(destination);
      await drain();
    }
    service.getValue = async () => ({
      key: "shared", type: "hash", hash: { source: "recreated", keep: "yes" }, totalCount: 2, ttlMs: -1, sizeBytes: 8, encoding: "hashtable",
    });
    await store.openKey("shared");
    hashDel.resolve();
    await removing;
    assert.deepEqual(state.value?.hash, { source: "recreated", keep: "yes" });
    assert.equal(state.value?.totalCount, 2);
  });
}

await test("conn.readOnly blocks all mutations and writable CLI toggles without calling the RPC service", async () => {
  const rpcCalls: string[] = [];
  service.deleteKey = async () => { rpcCalls.push("deleteKey"); };
  service.hashSet = async () => { rpcCalls.push("hashSet"); };
  service.hashDelete = async () => { rpcCalls.push("hashDelete"); };
  service.setTTL = async () => { rpcCalls.push("setTTL"); };
  service.setString = async () => { rpcCalls.push("setString"); };

  state.connections = state.connections.map((conn) => (conn.id === "a" ? { ...conn, readOnly: true } : conn));

  // Hash & TTL & Delete checks on read-only connection "a"
  state.keys = page(["ro:hash"]).keys;
  await store.openKey("ro:hash");
  await store.deleteSelectedKey();
  assert.equal(state.selectedKey, "ro:hash", "read-only connection keeps selected key on deleteSelectedKey");
  assert.equal(await store.saveHashField("field", "val"), false);
  assert.equal(await store.removeHashField("source"), false);
  assert.equal(await store.saveKeyTtl(60), false);
  assert.deepEqual(state.value?.hash, { source: "a/0" });
  assert.equal(state.value?.ttlMs, -1);

  // String & createNewKey checks on read-only connection "a"
  service.getValue = async (_id, _db, key) => stringVal(key, "immutable");
  await store.openKey("ro:str");
  assert.equal(await store.saveStringValue("mutated"), false);
  assert.equal(state.value?.stringValue, "immutable");
  assert.equal(await store.createNewKey({ key: "new:str", type: "string", value: "v", ttlSeconds: 30 }), false);
  assert.equal(await store.createNewKey({ key: "new:hash", type: "hash", field: "f", value: "v" }), false);

  // CLI readOnly cannot be disabled on read-only connection "a"
  const roSession = store.activeCliSession();
  assert.ok(roSession);
  assert.equal(roSession.readOnly, true);
  store.setCliReadOnly(false);
  assert.equal(store.activeCliSession()?.readOnly, true);

  // Explicit delete target referencing read-only connection "a" stays blocked even after switching to writable "b"
  await store.selectConnection("b");
  await drain();
  await store.deleteSelectedKey({ connId: "a", db: 0, key: "ro:hash" });

  assert.deepEqual(rpcCalls, [], "zero mutating RPC calls may be dispatched for a read-only connection");
});

await test("sampleNetKbps computes accurate KB/s from intervalMs and resets spikes after >60s gaps", async () => {
  assert.deepEqual(store.sampleNetKbps(null), { inKBps: 0, outKBps: 0 });
  assert.deepEqual(store.sampleNetKbps(undefined), { inKBps: 0, outKBps: 0 });
  assert.deepEqual(
    store.sampleNetKbps({ at: 1000, inferred: true, intervalMs: 2000, ops: 0, clients: 0, used: 0, latency: 0, netIn: 8192, netOut: 4096 }),
    { inKBps: 0, outKBps: 0 },
  );
  assert.deepEqual(
    store.sampleNetKbps({ at: 2000, intervalMs: 2000, ops: 0, clients: 1, used: 1, latency: 1, netIn: 4096, netOut: 2048 }),
    { inKBps: 2, outKBps: 1 },
  );
  // Default 4000ms interval when intervalMs is omitted, and 250ms floor for burst intervals
  assert.deepEqual(
    store.sampleNetKbps({ at: 4000, ops: 0, clients: 1, used: 1, latency: 1, netIn: 8192, netOut: 4096 }),
    { inKBps: 2, outKBps: 1 },
  );
  assert.deepEqual(
    store.sampleNetKbps({ at: 4100, intervalMs: 100, ops: 0, clients: 1, used: 1, latency: 1, netIn: 1024, netOut: 512 }),
    { inKBps: 4, outKBps: 2 },
  );

  // End-to-end history sampling across normal intervals and >60s background sleep gaps
  state.history.a = [];
  delete state.overview.a;
  const snapshots: OverviewSnapshot[] = [
    { ...overview(), atMs: 10_000, info: { redis_version: "test", total_net_input_bytes: "1000", total_net_output_bytes: "2000" } },
    { ...overview(), atMs: 12_000, info: { redis_version: "test", total_net_input_bytes: "5096", total_net_output_bytes: "4048" } },
    { ...overview(), atMs: 75_000, info: { redis_version: "test", total_net_input_bytes: "9000000", total_net_output_bytes: "8000000" } },
    { ...overview(), atMs: 79_000, info: { redis_version: "test", total_net_input_bytes: "9008192", total_net_output_bytes: "8004096" } },
  ];
  let idx = 0;
  service.getOverview = async () => snapshots[idx++]!;

  await store.loadOverview();
  await store.loadOverview();
  await store.loadOverview();
  await store.loadOverview();

  const hist = state.history.a!;
  assert.equal(hist.length, 4);
  assert.deepEqual(store.sampleNetKbps(hist[0]), { inKBps: 0, outKBps: 0 });
  assert.equal(hist[1]!.intervalMs, 2000);
  assert.deepEqual(store.sampleNetKbps(hist[1]), { inKBps: 2, outKBps: 1 });
  // Sample 2 followed a 63s gap (>60s), so cumulative byte counter jump is ignored
  assert.equal(hist[2]!.netIn, 0);
  assert.equal(hist[2]!.netOut, 0);
  assert.deepEqual(store.sampleNetKbps(hist[2]), { inKBps: 0, outKBps: 0 });
  // Sample 3 resumes normal 4s rate calculation from the post-gap baseline
  assert.equal(hist[3]!.intervalMs, 4000);
  assert.deepEqual(store.sampleNetKbps(hist[3]), { inKBps: 2, outKBps: 1 });
});

await test("closeCliSession closes tabs cleanly and resets when closing the last tab", async () => {
  const first = store.activeCliSession()!;
  assert.ok(first);
  first.lines = [{ id: 1, at: 1, command: "PING", lines: [{ kind: "string", text: "PONG" }] }];
  first.input = "GET unsent";

  // Closing the sole tab keeps 1 session and clears its lines and draft
  store.closeCliSession(0);
  assert.equal(store.cliSessionsFor(store.currentConnection()).length, 1);
  assert.equal(state.cliActive.a, 0);
  assert.deepEqual(store.activeCliSession()?.lines, []);
  assert.equal(store.activeCliSession()?.input, "");

  // Add two more tabs -> [s0, s1, s2], active = 2 (s2)
  store.addCliSession();
  store.addCliSession();
  const [s0, s1, s2] = store.cliSessionsFor(store.currentConnection());
  assert.ok(s0 && s1 && s2);
  assert.equal(state.cliActive.a, 2);
  assert.equal(store.activeCliSession()?.id, s2.id);

  // Out-of-range close indices are safe no-ops
  store.closeCliSession(-1);
  store.closeCliSession(99);
  assert.equal(store.cliSessionsFor(store.currentConnection()).length, 3);

  // Closing an earlier tab (0) shifts the active index so s2 remains active
  store.closeCliSession(0);
  assert.deepEqual(
    store.cliSessionsFor(store.currentConnection()).map((s) => s.id),
    [s1.id, s2.id],
  );
  assert.equal(state.cliActive.a, 1);
  assert.equal(store.activeCliSession()?.id, s2.id);

  // Closing the active last tab (1 -> s2) clamps active index to 0 (s1)
  store.closeCliSession(1);
  assert.deepEqual(
    store.cliSessionsFor(store.currentConnection()).map((s) => s.id),
    [s1.id],
  );
  assert.equal(state.cliActive.a, 0);
  assert.equal(store.activeCliSession()?.id, s1.id);
});

await test("successful TTL, String, and Hash-delete mutations supersede an earlier pending read", async () => {
  // TTL update vs earlier pending read
  await store.openKey("shared");
  const oldTtlRead = deferred<RedisValue>();
  service.getValue = async () => oldTtlRead.promise;
  const pendingTtlRead = store.openKey("shared");
  assert.equal(await store.saveKeyTtl(90), true);
  oldTtlRead.resolve({ ...value("shared", "outdated"), ttlMs: -1 });
  await pendingTtlRead;
  assert.equal(state.value?.ttlMs, 90_000);
  assert.equal(state.valueLoading, false);

  // String write vs earlier pending read
  service.getValue = async () => stringVal("str:key", "initial");
  await store.openKey("str:key");
  const oldStrRead = deferred<RedisValue>();
  service.getValue = async () => oldStrRead.promise;
  const pendingStrRead = store.openKey("str:key");
  assert.equal(await store.saveStringValue("updated"), true);
  oldStrRead.resolve(stringVal("str:key", "outdated"));
  await pendingStrRead;
  assert.equal(state.value?.stringValue, "updated");
  assert.equal(state.valueLoading, false);

  // Hash field delete vs earlier pending read
  service.getValue = async () => ({
    key: "hash:key", type: "hash", hash: { gone: "1", stay: "2" }, totalCount: 2, ttlMs: -1, sizeBytes: 4, encoding: "hashtable",
  });
  await store.openKey("hash:key");
  const oldHashRead = deferred<RedisValue>();
  service.getValue = async () => oldHashRead.promise;
  const pendingHashRead = store.openKey("hash:key");
  assert.equal(await store.removeHashField("gone"), true);
  oldHashRead.resolve({
    key: "hash:key", type: "hash", hash: { gone: "1", stay: "2" }, totalCount: 2, ttlMs: -1, sizeBytes: 4, encoding: "hashtable",
  });
  await pendingHashRead;
  assert.deepEqual(state.value?.hash, { stay: "2" });
  assert.equal(state.valueLoading, false);
});

await test("selectKey resets preview mode and invalidates in-flight writes during keyboard roving", async () => {
  const write = deferred<void>();
  service.hashSet = async () => write.promise;
  await store.openKey("first");
  state.valueMode = "html";
  const saving = store.saveHashField("f", "stale");

  // Keyboard roving selects "second" and then roves back to "first" before debounced openKey
  store.selectKey("second");
  assert.equal(state.selectedKey, "second");
  assert.equal(state.valueMode, "raw");
  assert.equal(state.value, null);
  store.selectKey("first");
  service.getValue = async () => value("first", "fresh");
  await store.openKey("first");

  write.resolve();
  await saving;
  assert.deepEqual(state.value?.hash, { source: "fresh" });
});

console.log(`Async state regressions: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
