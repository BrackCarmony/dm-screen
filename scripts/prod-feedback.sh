#!/bin/bash
# Run scripts/feedback.js against the live site's data on the droplet.
#
#   scripts/prod-feedback.sh list
#   scripts/prod-feedback.sh addressed 3f9a12bc "Fixed in the next deploy"
#
# DM_SCREEN_HOST picks the ssh host (default: elo).
set -euo pipefail

HOST="${DM_SCREEN_HOST:-elo}"
ARGS=$(printf ' %q' "$@")
ssh -o ClearAllForwardings=yes "$HOST" "cd /opt/dm-screen && sudo -u dmscreen DATA_DIR=/var/lib/dm-screen /opt/node22/bin/node scripts/feedback.js$ARGS"
