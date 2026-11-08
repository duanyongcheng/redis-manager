/** Release gates and asset collection for the pinned MyGo updater format.
 * Run with Bun to load mygo.config.ts. Tests import the pure helpers in Node.
 */
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RELEASE_TARGETS = ["darwin-universal", "windows-amd64"];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const publicKeyPrefix = Buffer.from("302a300506032b6570032100", "hex");
const privateKeyPrefix = Buffer.from("302e020100300506032b657004220420", "hex");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function base64Bytes(value, length, label) {
  const text = typeof value === "string" ? value.trim() : "";
  const bytes = Buffer.from(text, "base64");
  requireCondition(bytes.length === length && bytes.toString("base64") === text, `${label} is missing or invalid`);
  return bytes;
}

export function verificationKey(value) {
  const bytes = base64Bytes(value, 32, "MYGO_UPDATER_PUBLIC_KEY");
  return createPublicKey({ key: Buffer.concat([publicKeyPrefix, bytes]), type: "spki", format: "der" });
}

export function validateSigningKey(publicText, privateText) {
  const publicBytes = base64Bytes(publicText, 32, "MYGO_UPDATER_PUBLIC_KEY");
  const privateBytes = base64Bytes(privateText, 64, "MYGO_UPDATER_PRIVATE_KEY");
  const privateKey = createPrivateKey({ key: Buffer.concat([privateKeyPrefix, privateBytes.subarray(0, 32)]), type: "pkcs8", format: "der" });
  const derived = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32);
  requireCondition(derived.equals(publicBytes) && derived.equals(privateBytes.subarray(32)), "Updater public and private keys do not match");
}

export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => {
    const match = line.match(/^##\s+(?:\[([^\]]+)\]|([^\s]+))(?:\s.*)?$/);
    return (match?.[1] ?? match?.[2]) === version;
  });
  requireCondition(start >= 0, `CHANGELOG.md needs a ## ${version} section`);
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const notes = lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
  requireCondition(notes.length > 0, `CHANGELOG.md section ${version} is empty`);
  return notes;
}

export function releaseContext(config, env, changelog, requirePrivateKey = false) {
  const version = config.version;
  requireCondition(typeof version === "string" && stableVersion.test(version), "Release version must be stable X.Y.Z");
  const tag = env.RELEASE_TAG || env.GITHUB_REF_NAME;
  requireCondition(tag === `v${version}`, "Release tag must exactly match v + mygo.config.ts version");
  requireCondition(!env.GITHUB_REF || env.GITHUB_REF === `refs/tags/${tag}`, "Releases must run from the matching tag, not a branch");
  const key = verificationKey(config.updates?.publicKey);
  const repo = config.updates?.github;
  requireCondition(typeof repo === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), "updates.github must name a public owner/repository");
  requireCondition(!env.GITHUB_REPOSITORY || repo === env.GITHUB_REPOSITORY, "Workflow repository does not match updates.github");
  requireCondition(!config.updates.url && (!config.updates.tagPrefix || config.updates.tagPrefix === "v"), "This release workflow requires GitHub and the v tag prefix");
  const slug = config.slug || config.name;
  requireCondition(typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), "Release slug must use lowercase letters, digits and hyphens");
  if (requirePrivateKey) validateSigningKey(config.updates.publicKey, env.MYGO_UPDATER_PRIVATE_KEY);
  return { version, tag, repo, slug, key, notes: releaseNotes(changelog, version) };
}

function isEarlierVersion(candidate, version) {
  if (!stableVersion.test(candidate) || !stableVersion.test(version)) return false;
  const left = candidate.split(".").map(BigInt);
  const right = version.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest();
}

async function indexFiles(directory, index = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith(".app")) await indexFiles(file, index);
    else if (entry.isFile()) {
      const paths = index.get(entry.name) || [];
      index.set(entry.name, [...paths, file]);
    }
  }
  return index;
}

function oneFile(index, name) {
  const paths = index.get(name) || [];
  requireCondition(paths.length === 1, `${name}: expected exactly one regular file, found ${paths.length}`);
  return paths[0];
}

function assetURL(context, name, tag = context.tag) {
  return `https://github.com/${context.repo}/releases/download/${tag}/${name}`;
}

async function signedAsset(index, metadata, name, context) {
  requireCondition(metadata.url === assetURL(context, name), `${name}: update URL does not match this repository and tag`);
  const file = oneFile(index, name);
  const size = (await lstat(file)).size;
  requireCondition(Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size === size, `${name}: byte count does not match manifest`);
  const signature = base64Bytes(metadata.signature, 64, `${name} signature`);
  requireCondition(verify(null, await fileDigest(file), context.key, signature), `${name}: invalid update signature`);
  return file;
}

export async function validateAssets(input, context, targets = RELEASE_TARGETS) {
  requireCondition(targets.length > 0 && new Set(targets).size === targets.length && targets.every((target) => RELEASE_TARGETS.includes(target)), "Unsupported or duplicate release target");
  const index = await indexFiles(input);
  const assets = new Map();
  for (const target of targets) {
    const manifestName = `update-${target}.json`;
    const manifestPath = oneFile(index, manifestName);
    requireCondition((await lstat(manifestPath)).size <= 1024 * 1024, `${manifestName}: manifest is too large`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    requireCondition(manifest.version === context.version, `${manifestName}: version mismatch`);
    requireCondition(typeof manifest.notes === "string" && manifest.notes.replace(/\r\n?/g, "\n").trim() === context.notes, `${manifestName}: release notes do not match CHANGELOG.md`);
    const archiveName = `${context.slug}-${context.version}-${target}.tar.gz`;
    assets.set(archiveName, await signedAsset(index, manifest, archiveName, context));
    requireCondition(manifest.deltas === undefined || Array.isArray(manifest.deltas), `${manifestName}: deltas must be an array`);
    const bases = new Set();
    for (const delta of manifest.deltas || []) {
      requireCondition(typeof delta.from === "string" && isEarlierVersion(delta.from, context.version) && !bases.has(delta.from), `${manifestName}: invalid or duplicate delta base`);
      bases.add(delta.from);
      requireCondition(delta.size < manifest.size, `${manifestName}: delta is not smaller than the archive`);
      const name = `${context.slug}-${delta.from}-to-${context.version}-${target}.delta`;
      assets.set(name, await signedAsset(index, delta, name, context));
    }
    assets.set(manifestName, manifestPath);
    const installerName = target === "darwin-universal" ? `${context.slug}-${context.version}.dmg` : `${context.slug}-setup-${context.version}-amd64.exe`;
    const installer = oneFile(index, installerName);
    requireCondition((await lstat(installer)).size > 0, `${installerName}: installer is empty`);
    assets.set(installerName, installer);
    const script = target === "darwin-universal" ? "install.sh" : "install.ps1";
    if (index.has(script)) assets.set(script, oneFile(index, script));
  }
  return assets;
}

export async function checksumText(assets) {
  const lines = [];
  for (const [name, file] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${(await fileDigest(file)).toString("hex")}  ${name}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function collectAssets(input, output, context, targets = RELEASE_TARGETS) {
  const assets = await validateAssets(input, context, targets);
  await mkdir(output, { recursive: true });
  requireCondition((await readdir(output)).length === 0, "Release output directory must be empty");
  for (const [name, file] of assets) await copyFile(file, join(output, name));
  await writeFile(join(output, "SHA256SUMS"), await checksumText(assets));
  return [...assets.keys()];
}

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function optionalRelease(path, gh) {
  try {
    return JSON.parse(gh(["api", path]));
  } catch (error) {
    requireCondition(/HTTP 404/.test(String(error.stderr || "")), "Could not check release status; refusing to create or alter a release");
    return null;
  }
}

export async function publishRelease(directory, context, env, gh = runGh) {
  requireCondition(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === `refs/tags/${context.tag}`, "Publication is only allowed in the tag-triggered GitHub Actions job");
  const assets = await validateAssets(directory, context);
  requireCondition(await readFile(join(directory, "SHA256SUMS"), "utf8") === await checksumText(assets), "SHA256SUMS does not match the validated release assets");
  const existing = optionalRelease(`repos/${context.repo}/releases/tags/${context.tag}`, gh);
  requireCondition(!existing || existing.draft === true, "This release is already published; use a new version instead of overwriting it");
  const expectedNames = new Set([...assets.keys(), "SHA256SUMS"]);
  requireCondition(!existing?.assets?.some((asset) => !expectedNames.has(asset.name)), "Draft contains unexpected assets; review and remove them before retrying");
  const latest = optionalRelease(`repos/${context.repo}/releases/latest`, gh);
  const latestVersion = latest?.tag_name?.replace(/^v/, "");
  requireCondition(!latestVersion || !isEarlierVersion(context.version, latestVersion), "A newer stable release already exists; refusing to move latest backwards");
  const notes = join(directory, "RELEASE_NOTES.md");
  await writeFile(notes, context.notes);
  if (!existing) gh(["release", "create", context.tag, "--repo", context.repo, "--verify-tag", "--draft", "--title", context.tag, "--notes-file", notes]);
  else gh(["release", "edit", context.tag, "--repo", context.repo, "--title", context.tag, "--notes-file", notes]);
  const manifests = [...assets.keys()].filter((name) => name.startsWith("update-") && name.endsWith(".json"));
  const payloads = [...assets.keys()].filter((name) => !manifests.includes(name)).concat("SHA256SUMS");
  for (const names of [payloads, manifests]) {
    gh(["release", "upload", context.tag, ...names.map((name) => join(directory, name)), "--repo", context.repo, "--clobber"]);
  }
  gh(["release", "edit", context.tag, "--repo", context.repo, "--draft=false", "--prerelease=false", "--latest"]);
}

async function main() {
  const [command, input, output, target] = process.argv.slice(2);
  const config = (await import(pathToFileURL(join(repositoryRoot, "mygo.config.ts")).href)).default;
  const changelog = await readFile(join(repositoryRoot, config.updates?.changelog || "CHANGELOG.md"), "utf8");
  const context = releaseContext(config, process.env, changelog, command === "check");
  if (command === "check") console.log(`Release configuration ready: ${context.tag}`);
  else if (command === "collect" && input && output) {
    const files = await collectAssets(resolve(input), resolve(output), context, target ? [target] : RELEASE_TARGETS);
    console.log(`Validated ${files.length} release files for ${context.tag}`);
  } else if (command === "publish" && input) {
    await publishRelease(resolve(input), context, process.env);
    console.log(`Published ${context.tag}`);
  } else throw new Error("Usage: bun scripts/release.mjs check | collect <input> <empty-output> [target] | publish <staged-directory>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
