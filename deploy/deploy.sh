#!/usr/bin/env bash
# Runs on YOUR computer: uploads server/ and runs install.sh over SSH.
# Usage: deploy/deploy.sh root@<server-ip> [port]    (or ubuntu@<server-ip>: install.sh then runs with sudo)
# ssh asks for the password interactively (or set up a key once: ssh-copy-id root@HOST).
set -euo pipefail
export COPYFILE_DISABLE=1  # no macOS ._ files in the tarball
TARGET="${1:?usage: deploy/deploy.sh user@host [port]}"
PORT="${2:-8080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/era-src/deploy" "$STAGE/era-src/server" "$STAGE/era-src/userscript"
# explicit top-level list: tar --exclude=data would also drop public/data (the dictionary the server loads)
(cd "$ROOT/server" && tar -cf - $(ls -A | grep -vxE 'node_modules|data|\.env')) | tar -C "$STAGE/era-src/server" -xf -
cp "$ROOT"/userscript/english-reading-assistant*.user.js "$STAGE/era-src/userscript/"
cp "$ROOT/deploy/install.sh" "$STAGE/era-src/deploy/"
# deploy/server.env (git-ignored) becomes the server's .env on first install
[ -f "$ROOT/deploy/server.env" ] && cp "$ROOT/deploy/server.env" "$STAGE/era-src/server/.env"
tar -C "$STAGE" -czf "$STAGE/era-src.tgz" era-src
scp "$STAGE/era-src.tgz" "$TARGET:/tmp/era-src.tgz"
ssh -t "$TARGET" "rm -rf /tmp/era-src && tar -C /tmp -xzf /tmp/era-src.tgz && \$([ \"\$(id -u)\" = 0 ] || echo sudo) env PORT=$PORT bash /tmp/era-src/deploy/install.sh /tmp/era-src/server"
rm -rf "$STAGE"
