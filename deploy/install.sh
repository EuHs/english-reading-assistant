#!/usr/bin/env bash
# Runs ON the server (as root). Installs Node.js, the app, a systemd service, and opens the port.
# Usage: bash install.sh [/path/to/uploaded/server-dir]
set -euo pipefail
SRC="${1:-$(cd "$(dirname "$0")/../server" && pwd)}"
APP=/opt/era
PORT="${PORT:-8080}"
NODE_VER="${NODE_VER:-v22.14.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
NPM_TIMEOUT="${NPM_TIMEOUT:-1200}"   # seconds; past this, install without the optional Kokoro TTS packages

echo "==> 1/5 Node.js (>= 22.13 for built-in SQLite)"
need_node=1
if command -v node >/dev/null; then
  v=$(node -p 'process.versions.node.split(".").map(Number)' | tr -d '[] ' )
  maj=${v%%,*}; rest=${v#*,}; min=${rest%%,*}
  if [ "$maj" -gt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -ge 13 ]; }; then need_node=0; fi
fi
if [ $need_node -eq 1 ]; then
  arch=$(uname -m); case "$arch" in x86_64) arch=x64;; aarch64) arch=arm64;; esac
  url="https://cdn.npmmirror.com/binaries/node/${NODE_VER}/node-${NODE_VER}-linux-${arch}.tar.xz"
  echo "    downloading $url"
  curl -fsSL "$url" -o /tmp/node.tar.xz
  mkdir -p /usr/local/lib/nodejs && tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
  ln -sf /usr/local/lib/nodejs/node-${NODE_VER}-linux-${arch}/bin/{node,npm,npx} /usr/local/bin/
fi
node -v

echo "==> 2/5 App files -> $APP"
id era >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin era
mkdir -p "$APP"
# keep data/ and .env across upgrades; explicit top-level list because tar --exclude=data
# would also drop public/data (the dictionary the server loads at startup)
(cd "$SRC" && tar -cf - $(ls -A | grep -vxE 'node_modules|data|\.env')) | tar -C "$APP" -xf -
mkdir -p "$APP/data"
# userscripts, installable from http://<server>:PORT/userscript/ where the jsDelivr CDN is unreachable
if ls "$SRC"/../userscript/english-reading-assistant*.user.js >/dev/null 2>&1; then
  mkdir -p "$APP/public/userscript" && cp "$SRC"/../userscript/english-reading-assistant*.user.js "$APP/public/userscript/"
fi
if [ -f "$SRC/.env" ] && [ ! -f "$APP/.env" ]; then cp "$SRC/.env" "$APP/.env"; fi
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  sed -i "s/^API_TOKEN=.*/API_TOKEN=$(openssl rand -hex 24)/" "$APP/.env"
  [ -n "${AI_API_KEY:-}" ] && sed -i "s#^AI_API_KEY=.*#AI_API_KEY=${AI_API_KEY}#" "$APP/.env"
fi
sed -i "s/^PORT=.*/PORT=${PORT}/" "$APP/.env"

echo "==> 3/5 npm packages (registry: $NPM_REGISTRY; about 150 MB, usually a few minutes)"
cd "$APP"
# Kokoro TTS pulls in onnxruntime-node, whose install script otherwise downloads 225 MB of CUDA (GPU) libraries
# from GitHub on every Linux x64 server, with no timeout: from mainland China that stalls this step indefinitely.
# The server runs Kokoro on the CPU, and the CPU libraries ship inside the npm package itself.
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
npm_args=(--omit=dev --no-audit --no-fund --update-notifier=false --registry="$NPM_REGISTRY")
# npm ci starts from an empty node_modules, so files half-written by an interrupted earlier run can't linger
if ! timeout --foreground "$NPM_TIMEOUT" npm ci "${npm_args[@]}" --include=optional; then
  echo "    npm with the optional Kokoro TTS packages failed or ran past ${NPM_TIMEOUT}s; installing the server without them"
  npm ci "${npm_args[@]}" --omit=optional
fi
if node -e "import('kokoro-js').then(()=>process.exit(0),()=>process.exit(1))"; then echo "    Kokoro TTS: ok"; else echo "    Kokoro TTS unavailable (web app falls back to browser voices)"; fi
chown -R era:era "$APP"

echo "==> 4/5 systemd service"
cat > /etc/systemd/system/era.service <<UNIT
[Unit]
Description=English Reading Assistant server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=era
WorkingDirectory=$APP
ExecStart=/usr/local/bin/node --no-warnings src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
# Uncomment if the server needs an HTTP proxy to reach the AI API
# Environment=HTTPS_PROXY=http://127.0.0.1:7890
# Environment=NODE_USE_ENV_PROXY=1

[Install]
WantedBy=multi-user.target
UNIT
[ -x /usr/local/bin/node ] || sed -i "s#/usr/local/bin/node#$(command -v node)#" /etc/systemd/system/era.service
systemctl daemon-reload
systemctl enable era
# a single (re)start: starting and then restarting right away could cut off the first Kokoro model download
systemctl restart era

echo "==> 5/5 firewall"
if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then firewall-cmd --permanent --add-port=${PORT}/tcp && firewall-cmd --reload; fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow ${PORT}/tcp; fi

# the service takes a moment to load the dictionary; give it up to 30 s to answer
for i in $(seq 30); do
  curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null && echo && break
  if [ "$i" -eq 30 ]; then
    echo "❌ The service didn't answer on port ${PORT} within 30 s. Last log lines:"
    journalctl -u era -n 30 --no-pager 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
echo
echo "✅ Installed. Web app: http://<server-ip>:${PORT}/"
echo "   iPhone/iPad userscript: http://<server-ip>:${PORT}/userscript/english-reading-assistant.ios.user.js"
echo "   API token: $(grep ^API_TOKEN= "$APP/.env" | cut -d= -f2)"
echo "   Logs:      journalctl -u era -f"
echo "   Cloud firewall / security group: allow inbound TCP ${PORT}."
