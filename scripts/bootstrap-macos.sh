#!/usr/bin/env bash
# Portfolio Evolution — macOS bootstrap (update from GitHub + start).
# Used by Portfolio Evolution.app and runnable on its own for debugging.
set -euo pipefail

REPO_OWNER="msar"
REPO_NAME="etoro"
REPO_BRANCH="main"
NODE_VERSION="22.14.0"
MIN_NODE_MAJOR=20
APP_NAME="Portfolio Evolution"

SUPPORT_DIR="${PE_SUPPORT_DIR:-$HOME/Library/Application Support/Portfolio Evolution}"
APP_DIR="$SUPPORT_DIR/app"
RUNTIME_DIR="$SUPPORT_DIR/runtime"
NODE_DIR="$RUNTIME_DIR/node"
SHA_FILE="$SUPPORT_DIR/.installed-sha"
LOG_DIR="$SUPPORT_DIR/logs"
LOG_FILE="$LOG_DIR/bootstrap.log"
ZIP_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.zip"
COMMITS_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}"

mkdir -p "$SUPPORT_DIR" "$RUNTIME_DIR" "$LOG_DIR"

log() {
  local msg="$*"
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "$LOG_FILE" >/dev/null
  printf '%s\n' "$msg"
}

notify() {
  local msg="$1"
  osascript -e "display notification $(osascript_quote "$msg") with title $(osascript_quote "$APP_NAME")" 2>/dev/null || true
}

alert() {
  local msg="$1"
  osascript -e "display alert $(osascript_quote "$APP_NAME") message $(osascript_quote "$msg") as critical" 2>/dev/null || printf 'ERROR: %s\n' "$msg" >&2
}

# Escape a string for use inside an AppleScript quoted string
osascript_quote() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

die() {
  log "ERROR: $*"
  alert "$*"
  exit 1
}

# --- Node resolution ----------------------------------------------------------

node_major() {
  local bin="$1"
  "$bin" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

ensure_path_has_common_bins() {
  # GUI apps get a minimal PATH; include Homebrew locations.
  export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"
}

install_portable_node() {
  local arch tarball url tmp extract_dir
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) die "Unsupported Mac architecture: $(uname -m)" ;;
  esac

  tarball="node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pe-node.XXXXXX")"
  extract_dir="$tmp/extract"

  notify "Downloading Node.js ${NODE_VERSION}…"
  log "Downloading portable Node from $url"
  mkdir -p "$extract_dir"
  if ! curl -fsSL --connect-timeout 30 --retry 2 -o "$tmp/$tarball" "$url"; then
    rm -rf "$tmp"
    die "Could not download Node.js. Check your internet connection and try again."
  fi

  mkdir -p "$extract_dir"
  if ! tar -xzf "$tmp/$tarball" -C "$extract_dir"; then
    rm -rf "$tmp"
    die "Could not unpack Node.js download."
  fi

  rm -rf "$NODE_DIR"
  mkdir -p "$RUNTIME_DIR"
  mv "$extract_dir/node-v${NODE_VERSION}-darwin-${arch}" "$NODE_DIR"
  rm -rf "$tmp"

  if [[ ! -x "$NODE_DIR/bin/node" ]]; then
    die "Portable Node install is missing bin/node."
  fi
  log "Portable Node installed at $NODE_DIR"
}

ensure_node() {
  ensure_path_has_common_bins

  if [[ -x "$NODE_DIR/bin/node" ]]; then
    local cached_major
    cached_major="$(node_major "$NODE_DIR/bin/node")"
    if [[ "$cached_major" -ge "$MIN_NODE_MAJOR" ]]; then
      export PATH="$NODE_DIR/bin:$PATH"
      log "Using portable Node $( "$NODE_DIR/bin/node" -v )"
      return 0
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    local sys_major
    sys_major="$(node_major "$(command -v node)")"
    if [[ "$sys_major" -ge "$MIN_NODE_MAJOR" ]]; then
      log "Using system Node $(node -v) at $(command -v node)"
      return 0
    fi
    log "System Node is too old (need ${MIN_NODE_MAJOR}+); installing portable Node"
  else
    log "No system Node found; installing portable Node"
  fi

  install_portable_node
  export PATH="$NODE_DIR/bin:$PATH"
}

# --- App update from GitHub ---------------------------------------------------

fetch_remote_sha() {
  local json sha
  json="$(curl -fsSL --connect-timeout 20 --retry 2 \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: PortfolioEvolution-Bootstrap" \
    "$COMMITS_API" 2>/dev/null || true)"
  if [[ -z "$json" ]]; then
    echo ""
    return 0
  fi
  sha="$(printf '%s' "$json" | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)"
  printf '%s' "$sha"
}

download_and_install_app() {
  local remote_sha="${1:-}"
  local tmp zip_path extract_dir preserved data_src top

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pe-app.XXXXXX")"
  zip_path="$tmp/repo.zip"
  extract_dir="$tmp/extract"
  preserved="$tmp/preserved-data"

  notify "Downloading latest app…"
  log "Downloading $ZIP_URL"
  if ! curl -fsSL --connect-timeout 30 --retry 2 -o "$zip_path" "$ZIP_URL"; then
    rm -rf "$tmp"
    die "Could not download the app from GitHub. Check your internet connection."
  fi

  mkdir -p "$extract_dir"
  if ! unzip -q "$zip_path" -d "$extract_dir"; then
    rm -rf "$tmp"
    die "Could not unpack the app download."
  fi

  top="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -1)"
  if [[ -z "$top" || ! -f "$top/package.json" ]]; then
    rm -rf "$tmp"
    die "Downloaded archive did not look like the Portfolio Evolution project."
  fi

  if [[ -d "$APP_DIR/server/data" ]]; then
    log "Preserving server/data across update"
    cp -a "$APP_DIR/server/data" "$preserved"
  fi

  # Replace app tree
  rm -rf "$APP_DIR"
  mkdir -p "$SUPPORT_DIR"
  mv "$top" "$APP_DIR"

  if [[ -d "$preserved" ]]; then
    mkdir -p "$APP_DIR/server"
    rm -rf "$APP_DIR/server/data"
    mv "$preserved" "$APP_DIR/server/data"
  else
    mkdir -p "$APP_DIR/server/data"
  fi

  if [[ -n "$remote_sha" ]]; then
    printf '%s\n' "$remote_sha" >"$SHA_FILE"
  else
    # Best-effort: mark as updated even without SHA so we don't thrash forever
    printf 'unknown-%s\n' "$(date +%s)" >"$SHA_FILE"
  fi

  chmod +x "$APP_DIR/scripts/bootstrap-macos.sh" 2>/dev/null || true
  chmod +x "$APP_DIR/start.sh" 2>/dev/null || true

  rm -rf "$tmp"
  log "App installed at $APP_DIR (sha=${remote_sha:-unknown})"
}

ensure_app_up_to_date() {
  local remote_sha local_sha need_install=0

  if [[ ! -f "$APP_DIR/package.json" ]]; then
    need_install=1
    log "No local app install found"
  fi

  notify "Checking for updates…"
  remote_sha="$(fetch_remote_sha)"
  local_sha=""
  if [[ -f "$SHA_FILE" ]]; then
    local_sha="$(tr -d '[:space:]' <"$SHA_FILE")"
  fi

  if [[ "$need_install" -eq 1 ]]; then
    download_and_install_app "$remote_sha"
    return 0
  fi

  if [[ -z "$remote_sha" ]]; then
    log "Could not reach GitHub for update check; continuing with local install"
    return 0
  fi

  if [[ "$remote_sha" != "$local_sha" ]]; then
    log "Update available: local=${local_sha:-none} remote=$remote_sha"
    download_and_install_app "$remote_sha"
  else
    log "App is up to date ($local_sha)"
  fi
}

npm_install_if_needed() {
  local marker="$APP_DIR/node_modules/.pe-install-sha"
  local current_sha=""
  if [[ -f "$SHA_FILE" ]]; then
    current_sha="$(tr -d '[:space:]' <"$SHA_FILE")"
  fi

  if [[ -d "$APP_DIR/node_modules" && -f "$marker" ]]; then
    if [[ "$(tr -d '[:space:]' <"$marker")" == "$current_sha" && -n "$current_sha" ]]; then
      log "Dependencies already installed for this version"
      return 0
    fi
  fi

  notify "Installing dependencies…"
  log "Running npm install in $APP_DIR"
  (
    cd "$APP_DIR"
    npm install --no-fund --no-audit
  ) >>"$LOG_FILE" 2>&1 || die "npm install failed. See $LOG_FILE"
  printf '%s\n' "$current_sha" >"$marker"
  log "npm install finished"
}

# --- Start servers + open browser ---------------------------------------------

start_app() {
  local node_bin npm_bin app_q path_q
  node_bin="$(command -v node)"
  npm_bin="$(command -v npm)"
  if [[ -z "$node_bin" || -z "$npm_bin" ]]; then
    die "Node/npm not available after setup."
  fi

  notify "Starting Portfolio Evolution…"
  log "Starting servers with $node_bin / $npm_bin"

  # Quote for AppleScript string embedding
  app_q="${APP_DIR//\\/\\\\}"
  app_q="${app_q//\"/\\\"}"
  path_q="${PATH//\\/\\\\}"
  path_q="${path_q//\"/\\\"}"

  osascript <<EOF
tell application "Terminal"
  activate
  do script "export PATH=\"$path_q\"; cd \"$app_q\" && echo \"Portfolio Evolution — starting…\" && npm start"
end tell
EOF

  (
    for _ in $(seq 1 90); do
      if curl -sf -o /dev/null "http://localhost:5173/" 2>/dev/null; then
        open "http://localhost:5173/"
        log "Opened browser at http://localhost:5173/"
        exit 0
      fi
      sleep 1
    done
    log "Timed out waiting for http://localhost:5173/"
    alert "The app started but the browser page did not become ready in time. Check the Terminal window for errors."
  ) &
}

# --- Main ---------------------------------------------------------------------

main() {
  log "=== Portfolio Evolution bootstrap ==="
  log "Support dir: $SUPPORT_DIR"

  ensure_node
  ensure_app_up_to_date

  if [[ ! -f "$APP_DIR/package.json" ]]; then
    die "App files are missing after install."
  fi

  # Prefer the freshly downloaded bootstrap for future launches (launcher already
  # prefers APP_DIR script). Re-exec once after first install so updates to this
  # script apply immediately when we just replaced the tree.
  local installed_bootstrap="$APP_DIR/scripts/bootstrap-macos.sh"
  if [[ -x "$installed_bootstrap" && "${PE_BOOTSTRAP_REEVAL:-}" != "1" ]]; then
    if ! cmp -s "$installed_bootstrap" "${BASH_SOURCE[0]}" 2>/dev/null; then
      log "Newer bootstrap found in app tree; re-executing"
      export PE_BOOTSTRAP_REEVAL=1
      export PE_SUPPORT_DIR="$SUPPORT_DIR"
      exec "$installed_bootstrap"
    fi
  fi

  npm_install_if_needed
  start_app
  log "Bootstrap finished"
}

main "$@"
