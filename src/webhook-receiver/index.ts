import http from 'http';
import { parseWebhookPayload } from '../clickup-client/webhooks.js';

const PORT = process.env.WEBHOOK_PORT;
const SECRET = process.env.WEBHOOK_SECRET;
const FORWARD_URL = process.env.WEBHOOK_FORWARD_URL;

if (!PORT) {
  console.error('[WebhookReceiver] WEBHOOK_PORT not set — receiver disabled.');
  console.error('[WebhookReceiver] Set WEBHOOK_PORT (e.g. 3001) and optionally WEBHOOK_SECRET and WEBHOOK_FORWARD_URL.');
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  // Only accept POST /webhook
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // Collect raw body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8');

  // Parse JSON
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.writeHead(400);
    res.end('Invalid JSON');
    return;
  }

  // Validate HMAC and parse
  const signature = req.headers['x-signature'] as string | undefined;
  const result = parseWebhookPayload(payload, SECRET, signature);

  if (!result.valid && SECRET && signature) {
    console.warn(`[WebhookReceiver] Rejected — invalid HMAC (event=${result.event}, type=${result.object_type})`);
    res.writeHead(401);
    res.end('Invalid signature');
    return;
  }

  // Log the event
  console.log(
    `[WebhookReceiver] ${result.event} | ${result.operation} | ${result.object_type} ${result.object_id}` +
    (result.changes?.length ? ` | ${result.changes.length} change(s)` : '') +
    (result.hmac_validated ? ' | HMAC verified' : '')
  );

  // Forward if configured
  if (FORWARD_URL) {
    try {
      const forwardBody = JSON.stringify(result);
      await fetch(FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: forwardBody,
      });
      console.log(`[WebhookReceiver] Forwarded to ${FORWARD_URL}`);
    } catch (err: any) {
      console.error(`[WebhookReceiver] Forward failed: ${err.message}`);
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true }));
});

server.listen(parseInt(PORT, 10), () => {
  console.log(`[WebhookReceiver] Listening on port ${PORT}` +
    (SECRET ? ' with HMAC validation' : ' (no HMAC secret set)') +
    (FORWARD_URL ? `, forwarding to ${FORWARD_URL}` : ''));
});
