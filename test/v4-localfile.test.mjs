/**
 * The filesystem boundary.
 *
 * Found by red-teaming v4.2.0: `attach` called `readFile` on whatever path it was given, and it
 * was available under the `agent` profile — the one documented as unable to harm anything. So
 * an untrusted agent could attach `../.env`, read the ClickUp API token, and upload it. The
 * token carries full write access regardless of profile, which makes every other restriction in
 * the process decorative.
 *
 * The hole existed because `core/policy.ts` guards *outbound URLs*, and a local file read has no
 * URL. These tests defend the second chokepoint that covers the resource the first one cannot
 * see, and the headline case is the exfiltration path itself.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSandbox, readLocalFile } from '../build/v4/core/localfile.js';
import { buildContext, allTools } from '../build/v4/server.js';
import { toolsFor } from '../build/v4/tools/profiles.js';
import { attachTool } from '../build/v4/tools/extended.js';
import { ClickUpToolError } from '../build/v4/core/errors.js';

const WS = '9001';

/** project/.env is the prize; project/uploads is the sandbox. */
let base, project, uploads, sandbox;

before(async () => {
  // realpath because macOS hands out /var/... which is a symlink to /private/var — the same
  // canonicalisation the sandbox itself has to do.
  base = await realpath(await mkdtemp(join(tmpdir(), 'v4-fs-')));
  project = join(base, 'project');
  uploads = join(project, 'uploads');
  await mkdir(uploads, { recursive: true });
  await writeFile(join(project, '.env'), 'CLICKUP_API_TOKEN=pk_SECRET_NEVER_LEAVES\n');
  await writeFile(join(uploads, 'report.txt'), 'a legitimate attachment');
  sandbox = await resolveSandbox(uploads);
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('the attach sandbox', () => {
  test('THE FINDING: an agent cannot attach the .env beside its sandbox', async () => {
    const sent = [];
    const ctx = ctxWith(sent, sandbox);

    await assert.rejects(
      () => attachTool.handler({ task: 't1', file_path: join(uploads, '..', '.env') }, ctx),
      (err) => {
        assert.ok(err instanceof ClickUpToolError);
        assert.equal(err.code, 'policy', 'must propagate as a capability refusal');
        assert.match(err.message, /outside the directory/);
        return true;
      },
    );
    assert.equal(sent.length, 0, 'nothing may reach the wire, not even a failed upload');
  });

  test('a legitimate file inside the sandbox still uploads', async () => {
    const sent = [];
    const ctx = ctxWith(sent, sandbox);
    const out = await attachTool.handler(
      { task: 't1', file_path: join(uploads, 'report.txt') },
      ctx,
    );
    assert.match(out, /attached report\.txt/);
    assert.deepEqual(
      sent.map((s) => s.path),
      ['/task/t1/attachment'],
    );
  });

  test('an absolute path to a host secret is refused', async () => {
    await assert.rejects(
      () => readLocalFile('/etc/passwd', sandbox),
      (err) => err.code === 'policy',
    );
  });

  test('a symlink planted inside the sandbox cannot point out of it', async () => {
    // The case a purely textual `..` check gets wrong, and the reason realpath is load-bearing.
    const bait = join(uploads, 'innocent.txt');
    await symlink(join(project, '.env'), bait);
    await assert.rejects(
      () => readLocalFile(bait, sandbox),
      (err) => {
        assert.equal(err.code, 'policy');
        assert.match(err.message, /resolves to/, 'should say where it actually pointed');
        return true;
      },
    );
  });

  test('a sibling directory sharing the root prefix is not inside it', async () => {
    // `/…/uploads-evil` starts with `/…/uploads` but is not beneath it.
    const evil = `${uploads}-evil`;
    await mkdir(evil, { recursive: true });
    await writeFile(join(evil, 'x.txt'), 'nope');
    await assert.rejects(() => readLocalFile(join(evil, 'x.txt'), sandbox), (e) => e.code === 'policy');
  });

  test('the bytes come from the resolved path, not the requested one', async () => {
    const real = join(uploads, 'real.txt');
    await writeFile(real, 'REAL CONTENT');
    const link = join(uploads, 'link.txt');
    await symlink(real, link);
    const { bytes, realPath } = await readLocalFile(link, sandbox);
    assert.equal(bytes.toString(), 'REAL CONTENT');
    assert.equal(realPath, real);
  });

  test('a missing file fails without claiming a policy problem', async () => {
    await assert.rejects(
      () => readLocalFile(join(uploads, 'nope.txt'), sandbox),
      (err) => {
        assert.equal(err.code, undefined, 'not a capability refusal — the file simply is not there');
        return true;
      },
    );
  });

  test('with no sandbox configured, reads are unrestricted', async () => {
    const { bytes } = await readLocalFile(join(project, '.env'), null);
    assert.match(bytes.toString(), /pk_SECRET/);
  });
});

describe('sandbox configuration', () => {
  test('a relative root is rejected rather than resolved against the cwd', async () => {
    await assert.rejects(() => resolveSandbox('./uploads'), /absolute/);
  });

  test('a nonexistent root is fatal, not ignored', async () => {
    await assert.rejects(() => resolveSandbox(join(base, 'ghost')), /does not exist/);
  });

  test('a file is not a directory', async () => {
    await assert.rejects(() => resolveSandbox(join(uploads, 'report.txt')), /not a directory/);
  });

  test('unset means null, which means no sandbox', async () => {
    assert.equal(await resolveSandbox(undefined), null);
    assert.equal(await resolveSandbox('   '), null);
  });

  test('a symlinked root is canonicalised, so files reached through it are inside', async () => {
    const alias = join(base, 'alias');
    await symlink(uploads, alias);
    const viaAlias = await resolveSandbox(alias);
    assert.equal(viaAlias, uploads, 'root must be stored canonically');
    const { bytes } = await readLocalFile(join(alias, 'report.txt'), viaAlias);
    assert.equal(bytes.toString(), 'a legitimate attachment');
  });
});

describe('attach availability follows the sandbox', () => {
  const names = (profile, hasSandbox) =>
    toolsFor(allTools, profile, (t) => t, { hasSandbox }).map((t) => t.name);

  test('agent does not get attach at all without a configured sandbox', () => {
    assert.ok(!names('agent', false).includes('attach'), 'attach must not be offered unsandboxed');
    assert.ok(names('agent', true).includes('attach'));
  });

  test('core and full keep attach either way', () => {
    for (const p of ['core', 'full']) {
      for (const s of [false, true]) {
        assert.ok(names(p, s).includes('attach'), `${p} lost attach (sandbox=${s})`);
      }
    }
  });

  test('omitting the env argument withholds the capability rather than granting it', () => {
    assert.ok(!toolsFor(allTools, 'agent', (t) => t).map((t) => t.name).includes('attach'));
  });

  test('profiles stay strictly nested in both sandbox states', () => {
    for (const hasSandbox of [false, true]) {
      let prev = new Set();
      for (const p of ['read', 'agent', 'core', 'full']) {
        const cur = new Set(names(p, hasSandbox));
        for (const t of prev) {
          assert.ok(cur.has(t), `${p} dropped ${t} (sandbox=${hasSandbox})`);
        }
        prev = cur;
      }
    }
  });
});

/** A context whose fetch records rather than sends. */
function ctxWith(sent, attachRoot) {
  const fetchImpl = async (url, init = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v[23]/, '');
    sent.push({ method: init.method ?? 'GET', path: p });
    return new Response(JSON.stringify({ id: 'att1', title: 'x' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return buildContext({
    token: 'pk_test',
    profile: 'agent',
    workspaceId: WS,
    attachRoot,
    fetchImpl,
  });
}
