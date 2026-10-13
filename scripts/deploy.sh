#!/bin/bash
# Deploy the committed code to the droplet: build the client here, upload, install, restart.
# Keeps the previous release in /opt/dm-screen-prev and switches back to it if the new one doesn't answer.
#
#   scripts/deploy.sh [ssh-host]     (default: elo)
#
# One-time server setup (Node in /opt/node22, the dmscreen user, /etc/dm-screen.env, the upstart
# job, the nginx site) is described in the README.
set -euo pipefail

HOST="${1:-elo}"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit or stash your changes first; only committed code is deployed." >&2
  exit 1
fi

REV=$(git rev-parse --short HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Building $REV..."
npm run build >/dev/null
mkdir "$WORK/app"
git archive HEAD | tar -x -C "$WORK/app"
cp -R client/dist "$WORK/app/client/dist"
echo "$REV" > "$WORK/app/REVISION"
# COPYFILE_DISABLE keeps macOS from adding ._ metadata files.
COPYFILE_DISABLE=1 tar -czf "$WORK/release.tgz" -C "$WORK/app" .

echo "Uploading to $HOST..."
scp -q -o ClearAllForwardings=yes "$WORK/release.tgz" "$HOST:/tmp/dm-screen-release.tgz"

ssh -o ClearAllForwardings=yes "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export PATH=/opt/node22/bin:$PATH
rm -rf /opt/dm-screen-new
mkdir /opt/dm-screen-new
tar -xzf /tmp/dm-screen-release.tgz -C /opt/dm-screen-new
rm /tmp/dm-screen-release.tgz
(cd /opt/dm-screen-new && npm ci --omit=dev --no-audit --no-fund >/dev/null)
chown -R root:root /opt/dm-screen-new

up() { for i in $(seq 1 15); do curl -sf -o /dev/null http://127.0.0.1:3000/api/me && return 0; sleep 1; done; return 1; }

stop dm-screen || true
rm -rf /opt/dm-screen-prev
mv /opt/dm-screen /opt/dm-screen-prev
mv /opt/dm-screen-new /opt/dm-screen
start dm-screen
if up; then
  echo "Deployed $(cat /opt/dm-screen/REVISION)."
else
  echo "New release didn't answer; switching back. Log: /var/log/upstart/dm-screen.log" >&2
  stop dm-screen || true
  rm -rf /opt/dm-screen-failed
  mv /opt/dm-screen /opt/dm-screen-failed
  mv /opt/dm-screen-prev /opt/dm-screen
  start dm-screen
  exit 1
fi
REMOTE
