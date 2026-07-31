// Phase 2 tests: webhook signature verification and payload parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { parseWebhookPayload, verifyWebhookSignature } from '../build/clickup-client/webhooks.js';

const SECRET = 'test_webhook_secret';

const sign = (rawBody) => crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');

const samplePayload = {
  event: 'taskUpdated',
  task_id: 'abc123',
  webhook_id: 'wh1',
  payload: {
    version: {
      object_type: 'task',
      object_id: 'abc123',
      changes: [{ field: 'status', before: 'open', after: 'done' }],
      context: { audit_context: { userid: 42 } },
      relationships: [{ type: 'parent', object_type: 'list', object_id: 'l1' }],
    },
  },
  operation_display: 'update',
  timestamp: 1720000000,
};

// ── verifyWebhookSignature ─────────────────────────────────────────────

test('valid signature over raw body verifies', () => {
  const raw = JSON.stringify(samplePayload);
  assert.equal(verifyWebhookSignature(raw, SECRET, sign(raw)), true);
});

test('signature verifies against RAW bytes, not re-serialized object', () => {
  // Same JSON data, different formatting — exactly what ClickUp may send
  const raw = '{ "event": "taskUpdated",   "task_id": "abc123" }';
  const sig = sign(raw);
  assert.equal(verifyWebhookSignature(raw, SECRET, sig), true);
  // Re-serializing the parsed object produces different bytes → must NOT verify
  const reSerialized = JSON.stringify(JSON.parse(raw));
  assert.notEqual(raw, reSerialized);
  assert.equal(verifyWebhookSignature(reSerialized, SECRET, sig), false);
});

test('sha256= prefix on signature header is accepted', () => {
  const raw = JSON.stringify(samplePayload);
  assert.equal(verifyWebhookSignature(raw, SECRET, 'sha256=' + sign(raw)), true);
});

test('wrong signature fails', () => {
  const raw = JSON.stringify(samplePayload);
  assert.equal(verifyWebhookSignature(raw, SECRET, sign(raw + 'tampered')), false);
});

test('missing signature fails (no bypass)', () => {
  const raw = JSON.stringify(samplePayload);
  assert.equal(verifyWebhookSignature(raw, SECRET, undefined), false);
});

test('different-length signature fails safely (no timingSafeEqual throw)', () => {
  const raw = JSON.stringify(samplePayload);
  assert.equal(verifyWebhookSignature(raw, SECRET, 'deadbeef'), false);
});

// ── parseWebhookPayload ────────────────────────────────────────────────

test('SECURITY: secret set + missing signature → invalid (the old bypass)', () => {
  const raw = JSON.stringify(samplePayload);
  const result = parseWebhookPayload(samplePayload, SECRET, undefined, raw);
  assert.equal(result.valid, false);
  assert.equal(result.hmac_validated, false);
  // and no structure should be extracted for an unauthenticated payload
  assert.equal(result.event, undefined);
});

test('secret set + wrong signature → invalid', () => {
  const raw = JSON.stringify(samplePayload);
  const result = parseWebhookPayload(samplePayload, SECRET, 'sha256=' + sign('other'), raw);
  assert.equal(result.valid, false);
});

test('secret set + correct signature → valid, structured fields extracted', () => {
  const raw = JSON.stringify(samplePayload);
  const result = parseWebhookPayload(samplePayload, SECRET, sign(raw), raw);
  assert.equal(result.valid, true);
  assert.equal(result.hmac_validated, true);
  assert.equal(result.event, 'taskUpdated');
  assert.equal(result.object_type, 'task');
  assert.equal(result.object_id, 'abc123');
  assert.equal(result.operation, 'update');
  assert.equal(result.user_id, 42);
  assert.equal(result.changes.length, 1);
  assert.equal(result.relationships.length, 1);
});

test('no secret configured → parses without HMAC (hmac_validated false)', () => {
  const result = parseWebhookPayload(samplePayload);
  assert.equal(result.valid, true);
  assert.equal(result.hmac_validated, false);
  assert.equal(result.event, 'taskUpdated');
});

test('flat payload structure parses', () => {
  const flat = { event: 'listCreated', object_type: 'list', object_id: 'l9', operation: 'create', timestamp: 1 };
  const result = parseWebhookPayload(flat);
  assert.equal(result.valid, true);
  assert.equal(result.object_type, 'list');
  assert.equal(result.object_id, 'l9');
});
