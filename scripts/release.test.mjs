import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectAssets, publishRelease, releaseContext, releaseNotes, RELEASE_TARGETS, validateAssets, validateSigningKey } from "./release.mjs";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const seed = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
  return { publicText: pub.toString("base64"), privateText: Buffer.concat([seed, pub]).toString("base64"), privateKey };
}

const keys = keyPair();
const changelog = "# Changelog\n\n## 0.2.0\n\n- Test release.\n\n## 0.1.0\n\n- Old release.";
const config = { name: "redis-manager", version: "0.2.0", updates: { publicKey: keys.publicText, github: "duanyongcheng/redis-manager" } };
const env = { RELEASE_TAG: "v0.2.0", GITHUB_REF: "refs/tags/v0.2.0", GITHUB_REPOSITORY: config.updates.github, MYGO_UPDATER_PRIVATE_KEY: keys.privateText };
const context = releaseContext(config, env, changelog, true);

test("tag, stable version, repository, notes and signing material are required", () => {
  assert.equal(context.version, "0.2.0");
  assert.throws(() => releaseContext(config, { ...env, RELEASE_TAG: "v0.3.0" }, changelog, true), /exactly match/);
  assert.throws(() => releaseContext(config, { ...env, GITHUB_REF: "refs/heads/main" }, changelog, true), /not a branch/);
  assert.throws(() => releaseContext(config, { ...env, GITHUB_REPOSITORY: "other/repo" }, changelog), /repository/);
  assert.throws(() => releaseContext({ ...config, version: "0.2.0-beta.1" }, env, changelog), /stable/);
  assert.throws(() => releaseContext({ ...config, updates: undefined }, env, changelog), /PUBLIC_KEY/);
  assert.throws(() => releaseContext(config, { ...env, MYGO_UPDATER_PRIVATE_KEY: "" }, changelog, true), /PRIVATE_KEY/);
  assert.throws(() => releaseContext(config, env, "## 0.2.0\n\n## 0.1.0\nold", true), /empty/);
  assert.throws(() => releaseContext(config, env, "## 0.20.0\nother", true), /needs a/);
  const other = keyPair();
  assert.throws(() => validateSigningKey(keys.publicText, other.privateText), /do not match/);
  assert.equal(releaseNotes("## [0.2.0] - 2026-11-07\n\n- Notes\n## 0.1.0\nold", "0.2.0"), "- Notes");
});

async function fixture(t, withDelta = false) {
  const dir = await mkdtemp(join(tmpdir(), "redis-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, "input");
  await mkdir(input);
  const url = (name) => `https://github.com/${context.repo}/releases/download/${context.tag}/${name}`;
  const writeSigned = async (folder, name, content) => {
    const bytes = Buffer.from(content);
    await writeFile(join(folder, name), bytes);
    return { url: url(name), size: bytes.length, signature: sign(null, createHash("sha256").update(bytes).digest(), keys.privateKey).toString("base64") };
  };
  for (const target of RELEASE_TARGETS) {
    const folder = join(input, target);
    await mkdir(folder);
    const archive = await writeSigned(folder, `redis-manager-0.2.0-${target}.tar.gz`, `${target} archive contents `.repeat(25));
    const manifest = { version: "0.2.0", notes: context.notes, ...archive };
    if (withDelta) manifest.deltas = [{ from: "0.1.0", ...await writeSigned(folder, `redis-manager-0.1.0-to-0.2.0-${target}.delta`, "delta") }];
    await writeFile(join(folder, `update-${target}.json`), JSON.stringify(manifest));
    await writeFile(join(folder, target === "darwin-universal" ? "redis-manager-0.2.0.dmg" : "redis-manager-setup-0.2.0-amd64.exe"), "installer");
    await writeFile(join(folder, "SHA256SUMS"), "discard these platform-only checksums");
    await writeFile(join(folder, "mygo-update.key"), "never publish signing keys");
  }
  return { dir, input, output: join(dir, "output") };
}

async function alterManifest(input, fn) {
  const file = join(input, "darwin-universal", "update-darwin-universal.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  fn(value);
  await writeFile(file, JSON.stringify(value));
}

test("first release without deltas collects both targets and recomputes all checksums", async (t) => {
  const { input, output } = await fixture(t);
  const files = await collectAssets(input, output, context);
  assert.equal(files.length, 6);
  assert.ok(!files.includes("mygo-update.key"));
  const sums = await readFile(join(output, "SHA256SUMS"), "utf8");
  assert.equal(sums.trim().split("\n").length, 6);
  assert.ok(sums.includes("redis-manager-0.2.0-darwin-universal.tar.gz"));
  assert.ok(sums.includes("redis-manager-0.2.0-windows-amd64.tar.gz"));
  await assert.rejects(() => collectAssets(input, output, context), /must be empty/);
});

test("valid deltas are optional but advertised deltas must be present and authentic", async (t) => {
  const { input } = await fixture(t, true);
  assert.equal((await validateAssets(input, context)).size, 8);
  await writeFile(join(input, "darwin-universal", "redis-manager-0.1.0-to-0.2.0-darwin-universal.delta"), "alter");
  await assert.rejects(() => validateAssets(input, context), /invalid update signature/);
  await rm(join(input, "darwin-universal", "redis-manager-0.1.0-to-0.2.0-darwin-universal.delta"));
  await assert.rejects(() => validateAssets(input, context), /expected exactly one/);
});

test("missing platform or installer blocks the whole release", async (t) => {
  const { input } = await fixture(t);
  await rm(join(input, "windows-amd64", "redis-manager-setup-0.2.0-amd64.exe"));
  await assert.rejects(() => validateAssets(input, context), /setup.*expected exactly one/);
  await writeFile(join(input, "windows-amd64", "redis-manager-setup-0.2.0-amd64.exe"), "installer");
  await rm(join(input, "windows-amd64", "update-windows-amd64.json"));
  await assert.rejects(() => validateAssets(input, context), /update-windows-amd64.*expected exactly one/);
});

test("wrong tag URL, payload tampering and malformed version are rejected", async (t) => {
  const { input } = await fixture(t);
  await alterManifest(input, (manifest) => { manifest.url = manifest.url.replace("v0.2.0", "v0.1.0"); });
  await assert.rejects(() => validateAssets(input, context), /URL does not match/);
  await alterManifest(input, (manifest) => { manifest.url = manifest.url.replace("v0.1.0", "v0.2.0"); manifest.size += 1; });
  await assert.rejects(() => validateAssets(input, context), /byte count/);
  await alterManifest(input, (manifest) => { manifest.size -= 1; manifest.signature = "A".repeat(86) + "=="; });
  await assert.rejects(() => validateAssets(input, context), /invalid update signature/);
  await alterManifest(input, (manifest) => { manifest.version = "0.3.0"; });
  await assert.rejects(() => validateAssets(input, context), /version mismatch/);
});

test("collector rejects duplicate basenames instead of silently merging matrix outputs", async (t) => {
  const { input } = await fixture(t);
  const file = "update-darwin-universal.json";
  await writeFile(join(input, file), await readFile(join(input, "darwin-universal", file)));
  await assert.rejects(() => validateAssets(input, context), /expected exactly one.*found 2/);
});

function fakeGh({ existing = null, latest = null, failUpload = false } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "api") {
      const release = args[1].endsWith("/latest") ? latest : existing;
      if (release) return JSON.stringify(release);
      throw Object.assign(new Error("not found"), { stderr: "gh: Not Found (HTTP 404)" });
    }
    if (failUpload && args[1] === "upload") throw new Error("upload failed");
    return "";
  };
  return { gh, calls };
}

const ciEnv = { ...env, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" };

test("publication uploads payloads before manifests and only then makes draft public", async (t) => {
  const { input, output } = await fixture(t);
  await collectAssets(input, output, context);
  const { gh, calls } = fakeGh();
  await publishRelease(output, context, ciEnv, gh);
  const uploads = calls.filter((args) => args[1] === "upload");
  assert.equal(uploads.length, 2);
  assert.ok(uploads[0].some((arg) => arg.endsWith(".tar.gz")));
  assert.ok(!uploads[0].some((arg) => arg.endsWith(".json")));
  assert.ok(uploads[1].some((arg) => arg.endsWith("update-darwin-universal.json")));
  assert.ok(calls.at(-1).includes("--draft=false"));
});

test("partial failure, published release or downgrade cannot alter latest", async (t) => {
  const { input, output } = await fixture(t);
  await collectAssets(input, output, context);
  for (const scenario of [{ existing: { draft: false } }, { existing: { draft: true, assets: [{ name: "unexpected.exe" }] } }, { latest: { tag_name: "v0.3.0" } }, { failUpload: true }]) {
    const { gh, calls } = fakeGh(scenario);
    await assert.rejects(() => publishRelease(output, context, ciEnv, gh));
    assert.ok(!calls.some((args) => args.includes("--draft=false")));
  }
  const { gh, calls } = fakeGh();
  await assert.rejects(() => publishRelease(output, context, { ...ciEnv, GITHUB_EVENT_NAME: "pull_request" }, gh), /tag-triggered/);
  assert.equal(calls.length, 0);
});
