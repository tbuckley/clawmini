#!/usr/bin/env bash
# Wrap a single command in a gvisor (runsc) sandbox with restricted filesystem
# and HTTP_PROXY-routed network. Invoked by clawmini's environment "prefix".
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "gvisor-proxy: usage: $0 WORKSPACE_DIR AGENT_DIR HOME_DIR ENV_DIR COMMAND" >&2
  exit 2
fi

WORKSPACE_DIR="$1"
AGENT_DIR="$2"
HOME_DIR="$3"
ENV_DIR="$4"
COMMAND="$5"

if ! command -v runsc >/dev/null 2>&1; then
  echo "gvisor-proxy: runsc not found on PATH. Install gVisor: https://gvisor.dev/docs/user_guide/install/" >&2
  exit 127
fi
if ! command -v node >/dev/null 2>&1; then
  echo "gvisor-proxy: node not found on PATH (required to build OCI spec)." >&2
  exit 127
fi

# Bind-mount sources must exist on the host. Create the approved writable
# locations up front so first-time runs don't fail on a missing ~/.gemini etc.
mkdir -p \
  "$HOME_DIR/.gemini" \
  "$HOME_DIR/.npm" \
  "$HOME_DIR/.cache" \
  "$WORKSPACE_DIR/.clawmini"
[ -e "$HOME_DIR/.gitconfig" ] || : > "$HOME_DIR/.gitconfig"

BUNDLE_DIR=$(mktemp -d -t clawmini-gvisor-XXXXXX)
CONTAINER_ID="clawmini-$$-$(date +%s%N 2>/dev/null || date +%s)"
cleanup() {
  runsc delete --force "$CONTAINER_ID" >/dev/null 2>&1 || true
  rm -rf "$BUNDLE_DIR"
}
trap cleanup EXIT

CLAWMINI_WORKSPACE="$WORKSPACE_DIR" \
CLAWMINI_AGENT="$AGENT_DIR" \
CLAWMINI_HOME="$HOME_DIR" \
CLAWMINI_COMMAND="$COMMAND" \
CLAWMINI_PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
CLAWMINI_UID="$(id -u)" \
CLAWMINI_GID="$(id -g)" \
  node "$ENV_DIR/build-spec.mjs" > "$BUNDLE_DIR/config.json"

exec runsc --network=host --rootless run --bundle "$BUNDLE_DIR" "$CONTAINER_ID"
