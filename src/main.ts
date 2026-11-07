import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/themes.css";

/**
 * Entry point. The Go service is exposed by MyGo before this module runs;
 * we publish it on `window` for parity with the previous build and then boot
 * the UI, which keeps a single seam to the bindings in `core/api.ts`.
 */
import { RedisService } from "./mygo";

declare global {
  interface Window {
    RedisService?: typeof RedisService;
  }
}

if (!window.RedisService) window.RedisService = RedisService;

// `?preview=1` loads a browser-only fixture (scripts/preview-mock.js) so the
// shell can be screenshotted without the Go runtime; see scripts/screenshot.mjs.
if (new URLSearchParams(location.search).get("preview") === "1") {
  await import("../scripts/preview-mock.js");
}

window.__RM_OUTSIDE__ = (window as unknown as { RedisService?: unknown }).RedisService === RedisService;

void import("./app");
