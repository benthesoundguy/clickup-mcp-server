# Deploying for remote access (Claude web + mobile, or your own agents)

Goal: run this server on an always-on box, reachable over HTTPS, so remote
clients can use it.

```
client ──HTTPS──▶ Cloudflare Tunnel ──▶ VPS 127.0.0.1:8000 ──▶ ClickUp API
```

The server binds **loopback only**; the tunnel makes an outbound connection, so
no inbound ports (besides SSH) are ever open. Every MCP request must carry
`MCP_AUTH_TOKEN` as a Bearer header — unauthenticated requests get a 401 before
any tool runs.

> **Read this before choosing your edge auth.** If you put a Cloudflare Access
> *service-token* policy in front of the hostname, the **claude.ai connector will
> not be able to reach it** — claude.ai cannot send `CF-Access-Client-Id` /
> `CF-Access-Client-Secret` headers. Access and the claude.ai connector are
> mutually exclusive on the same hostname. See [§5](#5-choosing-your-edge-auth).

## 1. VPS

Oracle Cloud always-free Ampere A1 works well: Ubuntu 24.04, 1 OCPU / 6 GB is
already generous (idle RSS is ~90 MB). ARM64 is fully supported — there are no
native dependencies.

## 2. Install

```bash
git clone --branch v3.3.2 --depth 1 \
  https://github.com/benthesoundguy/clickup-mcp-server.git clickup-mcp
bash clickup-mcp/deploy/setup-vps.sh
```

The script installs Node 22, checks out the pinned tag into
`/opt/clickup-mcp-server`, builds, prunes to production deps, writes secrets to
`/etc/clickup-mcp/env` (root, `0600`), installs a hardened systemd unit, and
health-checks `127.0.0.1:8000`. It prints the generated `MCP_AUTH_TOKEN` once —
save it.

Re-run it to upgrade: `VERSION=v3.4.0 bash deploy/setup-vps.sh`.

**Doing it by hand?** The order matters:

```bash
npm ci                    # `prepare` builds during this step
npm prune --omit=dev
```

`npm ci --omit=dev` alone leaves `build/` empty — `tsc` is a devDependency.

Afterwards:

```bash
systemctl status clickup-mcp
journalctl -u clickup-mcp -f
```

## 3. Cloudflare Tunnel

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

cloudflared tunnel login
cloudflared tunnel create clickup-mcp
cloudflared tunnel route dns clickup-mcp mcp.YOURDOMAIN.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: clickup-mcp
credentials-file: /home/ubuntu/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: mcp.YOURDOMAIN.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
curl https://mcp.YOURDOMAIN.com/health
```

## 4. Connect a client

**Any client that can set headers** (your own agents, Claude Code, scripts):

```
POST https://mcp.YOURDOMAIN.com/mcp
Authorization: Bearer <MCP_AUTH_TOKEN>
Accept: application/json, text/event-stream
```

**claude.ai custom connector** (syncs to the Claude mobile app): its UI has no
custom-header field, so the token goes in the URL path:

```
https://mcp.YOURDOMAIN.com/mcp/<MCP_AUTH_TOKEN>
```

This requires `MCP_ALLOW_TOKEN_IN_PATH=1`, because strict mode refuses the path
form by default — URLs land in proxy and CDN access logs in a way headers do
not. Add it to `/etc/clickup-mcp/env` and restart. Settings → Connectors → Add
custom connector, OAuth off. Connectors are account-level, so the mobile app
picks it up automatically.

## 5. Choosing your edge auth

The app's bearer check always runs. The question is what sits in front of it.

| Edge policy | Your own agents | claude.ai connector (and mobile) |
|---|---|---|
| **Tunnel only** | ✅ Bearer header | ✅ token-in-path |
| **+ Access, service tokens** | ✅ send `CF-Access-Client-*` | ❌ **blocked — cannot send Access headers** |
| **+ Access, bypass rule for the hostname** | ✅ | ✅ |

Cloudflare Access is the stronger posture and is worth having if only your own
infrastructure calls this. But it **cannot coexist with the claude.ai connector
on the same hostname**. If you want both, the usual arrangement is two
hostnames pointing at the same tunnel:

- `mcp-internal.YOURDOMAIN.com` — Access service-token policy, header auth
- `mcp.YOURDOMAIN.com` — Access bypass, path-token auth for claude.ai

Both still pass the app's bearer check, so the token remains the last line
regardless of what the edge does.

## 6. Updating

```bash
sudo VERSION=v3.4.0 bash /opt/clickup-mcp-server/deploy/setup-vps.sh
```

Or by hand:

```bash
cd /opt/clickup-mcp-server
sudo git fetch --tags && sudo git checkout -f v3.4.0
sudo npm ci && sudo npm prune --omit=dev
sudo chown -R mcp:mcp . && sudo systemctl restart clickup-mcp
```

Confirm what is actually running — the build stamp is on `/health`, and
`server_info` reports it over MCP:

```bash
curl -s http://127.0.0.1:8000/health
```

## Security notes

- **The bearer token is the last thing between the internet and your ClickUp
  workspace.** Treat it like a password. Rotate by editing
  `/etc/clickup-mcp/env` and restarting; update any connector URL too.
- Secrets live at `/etc/clickup-mcp/env`, deliberately **outside**
  `WorkingDirectory`. The ClickUp client's `.env` lookup searches the working
  directory and outranks `process.env` — correct on a laptop, wrong on a server.
  `MCP_STRICT_ENV=1` disables that lookup entirely.
- Strict mode also means the server never generates or persists a credential,
  and exits `1` rather than starting misconfigured.
- The server never listens publicly; only the tunnel reaches it. Verify with
  `ss -ltnp | grep 8000` — expect `127.0.0.1:8000`, not `0.0.0.0:8000`.
- `users_*` and `guests_*` mutate real workspace membership and can affect
  billing seats. Nothing in the server gates them; restrict at the edge if
  more than one agent has the token.
- ClickUp's ~100 req/min limit is **per token**, so every client behind this
  endpoint shares one budget.
