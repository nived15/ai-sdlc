#!/bin/bash
#
# AI-SDLC Plugin Version-Check Hook (AISDLC-89)
#
# Thin shim that invokes the Node implementation. Lets GitHub Copilot CLI's
# `bash "${COPILOT_PLUGIN_ROOT}/hooks/check-plugin-version.sh"` invocation
# stay consistent with every other hook in this plugin.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-plugin-version.js"

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

exec node "$SCRIPT" "$@"
