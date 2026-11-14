import { defineConfig } from "mygo-cli";

// Public verification key only. The signing key stays in the CI secret.
const updatePublicKey = process.env.MYGO_UPDATER_PUBLIC_KEY?.trim();

export default defineConfig({
  name: "redis-manager",
  identifier: "top.fcodex.redismanager",
  version: "0.2.0",
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
  updates: updatePublicKey ? {
    publicKey: updatePublicKey,
    github: "duanyongcheng/redis-manager",
    changelog: "CHANGELOG.md",
    deltas: 3,
  } : undefined,
});
