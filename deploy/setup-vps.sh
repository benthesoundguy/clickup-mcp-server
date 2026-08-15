#!/usr/bin/env bash
# One-shot setup for the ClickUp MCP server on a fresh Ubuntu host.
# Tested target: Oracle Cloud always-free Ampere A1, Ubuntu 24.04 (aarch64).
#
#   bash setup-vps.sh                       # prompts for the ClickUp token
#   CLICKUP_API_TOKEN=pk_… bash setup-vps.sh    # non-interactive
#
# Idempotent: safe to re-run to upgrade to a newer tag.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/benthesoundguy/clickup-mcp-server}"
VERSION="${VERSION:-v3.3.2}"     # pin a tag; a service should not drift on redeploy
INSTALL_DIR=/opt/clickup-mcp-server
ENV_DIR=/etc/clickup-mcp
ENV_FILE="$ENV_DIR/env"
HTTP_PORT="${MCP_HTTP_PORT:-8000}"

echo "── Node.js 22 LTS ──"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "── Service user ──"
sudo useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin mcp 2>/dev/null || true

echo "── Fetching $VERSION ──"
if [ -d "$INSTALL_DIR/.git" ]; then
  sudo git -C "$INSTALL_DIR" fetch --tags --depth 1 origin "$VERSION"
  sudo git -C "$INSTALL_DIR" checkout -f "$VERSION"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo git clone --branch "$VERSION" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

echo "── Build ──"
cd "$INSTALL_DIR"
# Full install first: `prepare` compiles during npm ci, and tsc is a devDependency.
# `npm ci --omit=dev` alone would leave build/ empty.
sudo npm ci --no-fund --no-audit
sudo npm prune --omit=dev --no-fund
[ -f build/index.js ] || { echo "build/index.js missing after build — aborting"; exit 1; }
sudo chown -R mcp:mcp "$INSTALL_DIR"

echo "── Secrets ──"
# Deliberately outside INSTALL_DIR: the ClickUp client's .env lookup searches the
# working directory, so keeping credentials there invites a stray file silently
# outranking this one. MCP_STRICT_ENV=1 in the unit disables that lookup anyway.
sudo mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  if [ -z "${CLICKUP_API_TOKEN:-}" ]; then
    read -r -p "ClickUp API token (ClickUp → Settings → Apps → API Token): " CLICKUP_API_TOKEN
  fi
  MCP_TOKEN="${MCP_AUTH_TOKEN:-$(openssl rand -hex 24)}"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
CLICKUP_API_TOKEN=$CLICKUP_API_TOKEN
MCP_AUTH_TOKEN=$MCP_TOKEN
EOF
  sudo chown root:root "$ENV_FILE"
  sudo chmod 600 "$ENV_FILE"
  echo
  echo "  Generated MCP auth token: $MCP_TOKEN"
  echo "  Save it now — it is the bearer credential for every request."
  echo
else
  echo "  $ENV_FILE already exists, leaving it alone."
fi

echo "── systemd ──"
sudo cp "$INSTALL_DIR/deploy/clickup-mcp.service" /etc/systemd/system/
if [ "$HTTP_PORT" != "8000" ]; then
  sudo sed -i "s|^Environment=MCP_HTTP_PORT=.*|Environment=MCP_HTTP_PORT=$HTTP_PORT|" \
    /etc/systemd/system/clickup-mcp.service
fi
sudo systemd-analyze verify /etc/systemd/system/clickup-mcp.service || true
sudo systemctl daemon-reload
sudo systemctl enable --now clickup-mcp
sudo systemctl restart clickup-mcp

echo "── Health ──"
sleep 3
if curl -fsS "http://127.0.0.1:$HTTP_PORT/health"; then
  echo
  echo
  echo "Up. Listening on 127.0.0.1:$HTTP_PORT — loopback only, nothing exposed."
  echo "Next: Cloudflare Tunnel → deploy/DEPLOY.md step 3."
else
  echo
  echo "Health check failed. Logs:"
  sudo journalctl -u clickup-mcp -n 30 --no-pager
  exit 1
fi
