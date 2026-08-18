/**
 * `.env` loading.
 *
 * v4 shipped reading only `process.env`, so upgrading from v3 silently lost the token and the
 * server exited before it could say why — which a desktop MCP client shows as "server
 * disconnected". That was the whole of the reported "it was difficult to integrate".
 *
 * The precedence split is the part worth pinning: the token from the file outranks the
 * environment (so a rotation takes even when a client has cached a stale copy), but everything
 * else only fills a gap. If a stray `.env` outranked explicit configuration, a file in a working
 * directory could widen `MCP_PROFILE` — a capability escalation via the filesystem.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseEnvFile, loadEnvFile, envFileCandidates } from '../build/v4/core/env.js';
import { spawnSync } from 'node:child_process';

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'v4-env-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parsing', () => {
  test('plain assignments', () => {
    assert.deepEqual(parseEnvFile('CLICKUP_API_TOKEN=pk_abc\nMCP_PROFILE=agent'), {
      CLICKUP_API_TOKEN: 'pk_abc',
      MCP_PROFILE: 'agent',
    });
  });

  test('comments, blanks and `export` are tolerated', () => {
    const parsed = parseEnvFile(
      ['# a comment', '', '   ', 'export CLICKUP_API_TOKEN=pk_abc', '# trailing'].join('\n'),
    );
    assert.deepEqual(parsed, { CLICKUP_API_TOKEN: 'pk_abc' });
  });

  test('quotes are stripped, and a quoted value keeps its #', () => {
    assert.deepEqual(parseEnvFile('A="one two"\nB=\'x#y\'\nC=bare # note'), {
      A: 'one two',
      B: 'x#y',
      C: 'bare',
    });
  });

  test('surrounding whitespace does not become part of a token', () => {
    assert.equal(parseEnvFile('  CLICKUP_API_TOKEN =  pk_abc  ').CLICKUP_API_TOKEN, 'pk_abc');
  });

  test('malformed lines are skipped rather than guessed at', () => {
    assert.deepEqual(parseEnvFile('not an assignment\n=novalue\n1BAD=x\nOK=y'), { OK: 'y' });
  });
});

describe('precedence', () => {
  test('the token in the file outranks the environment', async () => {
    const d = join(dir, 'tok');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, '.env'), 'CLICKUP_API_TOKEN=pk_from_file\n');
    const env = { CLICKUP_API_TOKEN: 'pk_stale_from_client' };
    const r = loadEnvFile({ cwd: d, env });
    assert.equal(env.CLICKUP_API_TOKEN, 'pk_from_file', 'a rotated token must take effect');
    assert.equal(r.source, join(d, '.env'));
    assert.deepEqual(r.applied, ['CLICKUP_API_TOKEN']);
  });

  test('SECURITY: a .env cannot widen a profile set explicitly', async () => {
    const d = join(dir, 'prof');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, '.env'), 'MCP_PROFILE=full\nCLICKUP_ATTACH_ROOT=/\n');
    const env = { MCP_PROFILE: 'agent', CLICKUP_ATTACH_ROOT: '/srv/uploads' };
    loadEnvFile({ cwd: d, env });
    assert.equal(env.MCP_PROFILE, 'agent', 'a file must never escalate an explicit profile');
    assert.equal(env.CLICKUP_ATTACH_ROOT, '/srv/uploads', 'nor widen the sandbox');
  });

  test('but a .env does fill a gap the environment left', async () => {
    const d = join(dir, 'gap');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, '.env'), 'MCP_PROFILE=agent\n');
    const env = {};
    loadEnvFile({ cwd: d, env });
    assert.equal(env.MCP_PROFILE, 'agent');
  });

  test('an empty value in the file is not applied over anything', async () => {
    const d = join(dir, 'empty');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, '.env'), 'CLICKUP_API_TOKEN=\n');
    const env = { CLICKUP_API_TOKEN: 'pk_real' };
    loadEnvFile({ cwd: d, env });
    assert.equal(env.CLICKUP_API_TOKEN, 'pk_real');
  });
});

describe('lookup can be switched off', () => {
  for (const flag of ['MCP_STRICT_ENV', 'MCP_NO_ENV_FILE']) {
    test(`${flag}=1 disables the file entirely`, async () => {
      const d = join(dir, `off-${flag}`);
      await mkdir(d, { recursive: true });
      await writeFile(join(d, '.env'), 'CLICKUP_API_TOKEN=pk_from_file\n');
      const env = { [flag]: '1' };
      const r = loadEnvFile({ cwd: d, env });
      assert.equal(r.source, null);
      assert.equal(env.CLICKUP_API_TOKEN, undefined, 'a stray .env must not reach a server');
    });
  }
});

describe('search order', () => {
  test('three candidates, cwd first', () => {
    const c = envFileCandidates('file:///srv/app/build/v4/core/env.js', '/work');
    assert.equal(c.length, 3);
    assert.equal(c[0], join('/work', '.env'));
    assert.equal(c[1], join('/srv/app', '.env'), 'install root');
    assert.equal(c[2], join('/srv', '.env'), 'repo checked out inside a project folder');
  });

  test('missing files are skipped, not fatal', () => {
    const r = loadEnvFile({ cwd: join(dir, 'nope'), env: {}, moduleUrl: 'file:///nowhere/x/y/z.js' });
    assert.equal(r.source, null);
    assert.deepEqual(r.applied, []);
  });
});

/**
 * The `--check` diagnostic.
 *
 * Its own doc comment calls the missing-token message "the single most-read string in the
 * project" — it is what a first-time install sees — and until now nothing exercised it. These
 * spawn the built binary, because the value of the message is what a human reads on a terminal,
 * not what a function returns.
 *
 * Only the suppressed branch is spawn-tested. The enabled branch cannot be staged here: the
 * candidate list includes the install directory's parent, which in a source checkout is this
 * repo's own project root, and that holds a real `.env`. Testing it would mean relocating the
 * install, and a test that reaches the live API to prove a help string is the wrong trade.
 */
describe('--check diagnostic', () => {
  const run = (env) =>
    spawnSync(process.execPath, ['build/v4/index.js', '--check'], {
      encoding: 'utf8',
      env: { ...process.env, CLICKUP_API_TOKEN: '', ...env },
    }).stdout;

  for (const flag of ['MCP_NO_ENV_FILE', 'MCP_STRICT_ENV']) {
    test(`HONESTY: with ${flag}=1 it does not claim to have looked anywhere`, () => {
      // The bug this pins: the message announced that lookup was disabled and then, two lines
      // later, said the server "looked for one here" and listed four paths it never opened.
      // A reader sent to check those files never learns that a variable switched the search off.
      const out = run({ [flag]: '1' });
      assert.match(out, /CLICKUP_API_TOKEN is not set/);
      assert.doesNotMatch(out, /looked for one here/);
      assert.match(out, /no file was opened/);
      // The paths still appear, because knowing where it *would* look is the useful part.
      assert.match(out, /would read, in order/);
    });
  }

  test('it never prints the token', () => {
    const out = run({ MCP_NO_ENV_FILE: '1', CLICKUP_API_TOKEN: 'pk_supersecret_value_here' });
    assert.doesNotMatch(out, /pk_supersecret_value_here/);
  });
});
