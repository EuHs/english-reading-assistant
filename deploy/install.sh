#!/usr/bin/env bash
# Runs ON the server (as root). Installs Node.js, the app, a systemd service, and opens the port.
# Usage: bash install.sh [/path/to/uploaded/server-dir]
set -euo pipefail
SRC="${1:-$(cd "$(dirname "$0")/../server" && pwd)}"
APP=/opt/era
PORT="${PORT:-8080}"
NODE_VER="${NODE_VER:-v22.14.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

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

echo "==> 3/5 npm install (registry: $NPM_REGISTRY)"
cd "$APP"
npm install --omit=dev --include=optional --no-audit --no-fund --registry="$NPM_REGISTRY"
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
systemctl enable --now era
systemctl restart era

echo "==> 5/5 firewall"
if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then firewall-cmd --permanent --add-port=${PORT}/tcp && firewall-cmd --reload; fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow ${PORT}/tcp; fi

sleep 2
curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo
echo
echo "✅ Installed. Web app: http://<server-ip>:${PORT}/"
echo "   iPhone/iPad userscript: http://<server-ip>:${PORT}/userscript/english-reading-assistant.ios.user.js"
echo "   API token: $(grep ^API_TOKEN= "$APP/.env" | cut -d= -f2)"
echo "   Logs:      journalctl -u era -f"
echo "   Cloud firewall / security group: allow inbound TCP ${PORT}."
