#!/usr/bin/env bash
# ============================================================================
# Build & package Redis Manager.
#
#   scripts/build.sh mac          # macOS .app + .dmg (default: host arch)
#   scripts/build.sh mac --arch universal
#   scripts/build.sh all          # macOS + web build
#   scripts/build.sh web          # browser build into build/web
#   scripts/build.sh checks       # typecheck + go vet only
#
# Flags:
#   --arch <arm64|amd64|universal>   macOS arch (default: host arch)
#   --platform <goos/goarch,...>     explicit mygo platform list, e.g.
#                                    darwin/universal,linux/amd64,windows/amd64
#   --sign <identity|->              macOS signing identity ("-" = ad hoc,
#                                    default: mygo.json / unsigned)
#   --skip-dmg                       no disk image
#   --skip-installer                 no Windows NSIS installer
#   --no-checks                      skip typecheck + go vet
#   --no-clean                       keep previous artifacts in build/
#   -h, --help                       this help
#
# Artifacts land in build/<platform>/; nothing is uploaded anywhere.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- pretty output ----------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_DIM=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""
fi
step() { printf "\n%s▸ %s%s\n" "$C_CYAN$C_BOLD" "$*" "$C_RESET"; }
info() { printf "  %s\n" "$*"; }
ok()   { printf "  %s✔%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf "  %s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf "\n%s✘ %s%s\n" "$C_RED$C_BOLD" "$*" "$C_RESET" >&2; exit 1; }

usage() { awk 'NR>1 && /^# =+$/ {exit} NR>1 {sub(/^# ?/, ""); print}' "${BASH_SOURCE[0]}"; }

# --- config -----------------------------------------------------------------
NAME="$(node -p "require('./package.json').name")"
# The app version lives once, in mygo.config.ts, which drives the bundle.
VERSION="$(sed -n '/^export default defineConfig({/,/^});/p' mygo.config.ts \
  | grep -oE '^[[:space:]]*version:[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"/\1/')"
[[ -n "$VERSION" ]] || die "cannot read version from mygo.config.ts"
OUT="$ROOT/build"

TASK="mac"
if [[ $# -gt 0 && "$1" != -* ]]; then TASK="$1"; shift; fi

ARCH="$(uname -m)"
[[ "$ARCH" == "x86_64" ]] && ARCH="amd64"
PLATFORM=""
SIGN=""
SKIP_DMG=0
SKIP_INSTALLER=0
DO_CHECKS=1
CLEAN=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)           ARCH="${2:?--arch needs a value}"; shift 2 ;;
    --platform)       PLATFORM="${2:?--platform needs a value}"; shift 2 ;;
    --sign)           SIGN="${2:?--sign needs a value}"; shift 2 ;;
    --skip-dmg)       SKIP_DMG=1; shift ;;
    --skip-installer) SKIP_INSTALLER=1; shift ;;
    --no-checks)      DO_CHECKS=0; shift ;;
    --no-clean)       CLEAN=0; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                die "unknown argument: $1  (try --help)" ;;
  esac
done

if [[ -z "$PLATFORM" ]]; then
  case "$TASK" in
    mac)    PLATFORM="darwin/$ARCH" ;;
    web)    PLATFORM="web" ;;
    all)    PLATFORM="darwin/$ARCH,web" ;;
    checks) PLATFORM="" ;;
    *)      die "unknown task: $TASK  (mac | web | all | checks)" ;;
  esac
fi

case "$ARCH" in
  arm64|amd64|universal) ;;
  *) die "unsupported arch: $ARCH (arm64 | amd64 | universal)" ;;
esac

# --- dmg probe --------------------------------------------------------------
if [[ $SKIP_DMG -eq 0 && ",$PLATFORM," == *"darwin/"* ]]; then
  if ! hdiutil create -ov -quiet -volname rm-probe -format UDRW \
      "${TMPDIR:-/tmp}/rm-dmg-probe.dmg" >/dev/null 2>&1; then
    SKIP_DMG=1
    NO_DMG_REASON="hdiutil cannot create images here (sandbox / no mount permission)"
  else
    rm -f "${TMPDIR:-/tmp}/rm-dmg-probe.dmg"
  fi
fi

# --- preflight --------------------------------------------------------------
step "Preflight"
for bin in go bun node; do
  command -v "$bin" >/dev/null 2>&1 || die "missing tool: $bin"
done
[[ -x node_modules/.bin/mygo ]] || die "mygo CLI not found — run 'bun install' first"
[[ -f src/mygo.ts ]] || warn "src/mygo.ts missing; run 'bun run generate' for fresh bindings"

REVISION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
DIRTY=""
[[ -n "$(git status --porcelain 2>/dev/null || true)" ]] && { DIRTY=" (dirty)"; warn "working tree has uncommitted changes — they go into the build"; }

printf "  %s%-10s%s %s · go %s · bun %s\n" "$C_DIM" "toolchain" "$C_RESET" \
  "mygo $(node -p "require('./node_modules/mygo-cli/package.json').version")" \
  "$(go version | awk '{print $3}')" "$(bun --version)"
printf "  %s%-10s%s %s%s @ %s\n" "$C_DIM" "version" "$C_RESET" "$NAME" "" "$VERSION$DIRTY"
printf "  %s%-10s%s %s\n" "$C_DIM" "revision" "$C_RESET" "$REVISION"
printf "  %s%-10s%s %s\n" "$C_DIM" "targets" "$C_RESET" "${PLATFORM:-— (checks only)}"
printf "  %s%-10s%s %s\n" "$C_DIM" "output" "$C_RESET" "${OUT#"$ROOT"/}/"

# Sandboxes and some CI images keep Go's caches read-only; fall back to a
# temp build cache (slower, but self-contained) unless the caller chose one.
use_writable_cache() { # $1 = env var name, $2 = dir reported by go env
  [[ -d "$2" && -w "$2" ]] && return 0
  local tmp="${TMPDIR:-/tmp}/redis-manager-build" lower
  mkdir -p "$tmp" || return 0
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  export "$1=$tmp/$lower"
  warn "$1=$2 is not writable → using $tmp/$lower"
}

# --- clean ------------------------------------------------------------------
if [[ $CLEAN -eq 1 && -n "$PLATFORM" ]]; then
  step "Cleaning"
  rm -rf "$OUT" dist
  ok "build/ and dist/ removed"
fi

use_writable_cache GOCACHE "$(go env GOCACHE)"

# --- checks -----------------------------------------------------------------
if [[ $DO_CHECKS -eq 1 ]]; then
  step "Checks"
  node_modules/.bin/tsc --noEmit || die "TypeScript typecheck failed"
  ok "tsc --noEmit"
  go vet ./... || die "go vet failed"
  ok "go vet ./..."
fi

if [[ "$TASK" == "checks" ]]; then
  printf "\n%s✔ checks passed%s\n" "$C_GREEN$C_BOLD" "$C_RESET"
  exit 0
fi

# --- build ------------------------------------------------------------------
step "Building $PLATFORM"
BUILD_START=$(date +%s)

MYGO_ARGS=(build -platform "$PLATFORM" -o "$OUT")
[[ $SKIP_DMG -eq 1 ]]       && MYGO_ARGS+=(-skip-dmg)
[[ $SKIP_INSTALLER -eq 1 ]] && MYGO_ARGS+=(-skip-installer)
[[ -n "$SIGN" ]]            && MYGO_ARGS+=(-sign "$SIGN")

# mygo runs buildCommand (tsc + vite) itself and embeds dist/ into the binary.
if [[ $SKIP_DMG -eq 1 && -n "${NO_DMG_REASON:-}" ]]; then
  warn "skipping the .dmg — $NO_DMG_REASON"
fi
node_modules/.bin/mygo "${MYGO_ARGS[@]}" || die "mygo build failed"
BUILD_END=$(date +%s)

# --- report -----------------------------------------------------------------
step "Artifacts"
list_artifacts() {
  find "$OUT" -path '*/.*' -prune -o -type f \
    \( -name '*.dmg' -o -name '*.exe' -o -name '*.tar.gz' -o -name '*.deb' \
       -o -name 'index.html' \) -print0 \
  | while IFS= read -r -d '' f; do
      printf "  %s%6s%s  %s\n" "$C_DIM" "$(du -h "$f" | cut -f1)" "$C_RESET" "${f#"$ROOT"/}"
    done
  find "$OUT" -path '*/.*' -prune -o -type d -name '*.app' -print0 \
  | while IFS= read -r -d '' d; do
      printf "  %s%6s%s  %s/\n" "$C_DIM" "$(du -sh "$d" | cut -f1)" "$C_RESET" "${d#"$ROOT"/}"
    done
}
ARTIFACTS="$(list_artifacts | sort)"
[[ -n "$ARTIFACTS" ]] && printf "%s\n" "$ARTIFACTS" || warn "no artifacts found under ${OUT#"$ROOT"/}/"

printf "\n%s✔ built in %ss%s\n" "$C_GREEN$C_BOLD" "$((BUILD_END - BUILD_START))" "$C_RESET"
