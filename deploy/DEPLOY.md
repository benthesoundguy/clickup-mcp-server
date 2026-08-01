# Deploying for Claude web + mobile

Goal: run this server on an always-on box, reachable over HTTPS, so
claude.ai custom connectors (which sync to the Claude mobile app) can use it.

Architecture:

```
Claude (web/mobile) ──HTTPS──▶ Cloudflare Tunnel ──▶ VPS localhost:8809 ──▶ ClickUp API
```

The server binds only to localhost on the VPS; Cloudflare Tunnel makes the
outbound connection, so **no inbound ports** (besides SSH) are ever open.
Every MCP request must carry the `MCP_AUTH_TOKEN` (in the URL path or as a
Bearer header) — unauthenticated requests get a 401 before any tool runs.

## 1. VPS (Oracle Cloud always-free works well)

- Create a VM: **Ampere A1** shape (up to 4 OCPU / 24 GB free), Ubuntu 22.04
  or 24.04 minimal. 1 OCPU / 6 GB is far more than this server needs.
- SSH in with the key you created during setup.

## 2. Install the server

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
bash clickup-mcp-server/deploy/setup-vps.sh
```

The script installs Node 22, builds the server into `/opt/clickup-mcp-server`,
prompts for your ClickUp API token, **generates the MCP auth token**
(save it!), and starts a hardened systemd service listening on
`127.0.0.1:8809`.

Useful afterwards:

```bash
systemctl status clickup-mcp        # is it up
journalctl -u clickup-mcp -f        # live logs
sudo systemctl restart clickup-mcp  # after a git pull + rebuild
```

## 3. Cloudflare Tunnel

On the VPS:

```bash
# Install cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

# Authenticate against your Cloudflare account (opens a browser URL to approve)
cloudflared tunnel login

# Create the tunnel and route a hostname on your domain to it
cloudflared tunnel create clickup-mcp
cloudflared tunnel route dns clickup-mcp clickup-mcp.YOURDOMAIN.com
```

Config — `/etc/cloudflared/config.yml`:

```yaml
tunnel: clickup-mcp
credentials-file: /home/ubuntu/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: clickup-mcp.YOURDOMAIN.com
    service: http://127.0.0.1:8809
  - service: http_status:404
```

Run it as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Check from anywhere:

```bash
curl https://clickup-mcp.YOURDOMAIN.com/healthz
```

## 4. Add the connector to Claude

1. On **claude.ai** (browser): Settings → **Connectors** → **Add custom connector**.
2. URL — the token goes **in the path** (the connector UI has no
   custom-header field):

   ```
   https://clickup-mcp.YOURDOMAIN.com/mcp/YOUR_MCP_AUTH_TOKEN
   ```

3. Leave OAuth off. Save. Enable the connector in a chat's tools menu.
4. Open the Claude **mobile app** — the connector is already there
   (connectors are account-level). Talk to your project manager.

## 5. Updating later

```bash
cd /opt/clickup-mcp-server
sudo git pull
sudo npx tsc
sudo chown -R mcp:mcp .
sudo systemctl restart clickup-mcp
```

## Security notes

- The MCP auth token is the only thing between the internet and your
  ClickUp workspace. Treat it like a password; rotate it by editing
  `/opt/clickup-mcp-server/.env` and restarting the service. Rotating also
  means updating the connector URL in claude.ai.
- The URL (with its token) appears in Cloudflare's proxy logs for your own
  account. If that bothers you, use the Bearer-header form with a client
  that supports custom headers.
- The server never listens publicly; only the tunnel reaches it.
- Optional extra belt-and-suspenders: put a Cloudflare Access policy in
  front of the hostname — though note claude.ai's connector cannot pass
  Access service tokens, so only do this if you switch to header auth via
  a different client.
