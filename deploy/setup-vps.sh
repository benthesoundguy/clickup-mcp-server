#!/usr/bin/env bash
# One-shot setup for the ClickUp MCP server on a fresh Ubuntu VPS
# (tested target: Oracle Cloud always-free Ampere, Ubuntu 22.04/24.04).
#
# Run as a sudo-capable user:  bash setup-vps.sh
# Prompts for your ClickUp API token; generates the MCP auth token for you.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/benthesoundguy/clickup-mcp-server}"
INSTALL_DIR=/opt/clickup-mcp-server
HTTP_PORT="${MCP_HTTP_PORT:-8809}"

echo "── Installing Node.js 22 LTS ──"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "── Creating service user + directory ──"
sudo useradd --system --create-home --shell /usr/sbin/nologin mcp 2>/dev/null || true
sudo mkdir -p "$INSTALL_DIR"

echo "── Fetching code ──"
if [ -d "$INSTALL_DIR/.git" ]; then
  sudo git -C "$INSTALL_DIR" pull
else
  sudo git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo "── Building ──"
cd "$INSTALL_DIR"
sudo npm install --omit=dev --ignore-scripts
sudo npm install typescript --no-save
sudo npx tsc
sudo chown -R mcp:mcp "$INSTALL_DIR"

echo "── Configuring ──"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  read -r -p "ClickUp API token (from ClickUp → Settings → Apps): " CLICKUP_TOKEN
  MCP_TOKEN=$(openssl rand -hex 24)
  sudo tee "$INSTALL_DIR/.env" >/dev/null <<EOF
CLICKUP_API_TOKEN=$CLICKUP_TOKEN
MCP_HTTP_PORT=$HTTP_PORT
MCP_AUTH_TOKEN=$MCP_TOKEN
EOF
  sudo chown mcp:mcp "$INSTALL_DIR/.env"
  sudo chmod 600 "$INSTALL_DIR/.env"
  echo
  echo "Generated MCP auth token: $MCP_TOKEN"
  echo "(You'll paste this into the connector URL — keep it secret.)"
fi

echo "── Installing systemd service ──"
sudo cp "$INSTALL_DIR/deploy/clickup-mcp.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clickup-mcp

sleep 2
echo "── Health check ──"
curl -fsS "http://127.0.0.1:$HTTP_PORT/healthz" && echo
echo
echo "Done. The server listens on 127.0.0.1:$HTTP_PORT (not exposed publicly)."
echo "Next: connect Cloudflare Tunnel — see deploy/DEPLOY.md, step 3."
