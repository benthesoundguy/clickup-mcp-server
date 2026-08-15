/**
 * The filesystem boundary.
 *
 * `core/policy.ts` inspects outbound HTTP requests, and for every capability in this server but
 * one, that is the right place to stand: the only thing a tool can touch is a ClickUp object,
 * and every ClickUp object is addressed by a URL. `attach` breaks that assumption. It reads a
 * file off the local disk, and no amount of URL inspection can see that read.
 *
 * So the guarantee had a hole exactly the size of the resource it never modelled. An `agent`
 * connection — the profile documented as unable to harm anything — could attach `../.env`,
 * obtain the ClickUp API token, and upload it to a task. The token carries full write access
 * regardless of profile, so that single read defeats every other restriction in the process.
 * Host secrets (`~/.ssh/id_rsa`, `/etc/passwd`) are reachable the same way.
 *
 * This module is the missing chokepoint, deliberately the same shape as the HTTP one: one
 * function that every local read passes through, enforcing a rule that fits in a sentence.
 *
 *     A read is permitted when no sandbox is configured, or when the file's real path — after
 *     resolving `..` and every symlink — is the sandbox root or lies beneath it.
 *
 * Symlink resolution is the load-bearing part. A textual `..` check is defeated by a symlink
 * planted inside the root, which is precisely the move an untrusted agent that can already
 * write files would make.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { ClickUpToolError } from './errors.js';

/**
 * Validate and canonicalise `CLICKUP_ATTACH_ROOT`.
 *
 * Resolved once at startup, and resolved *through symlinks*, so every later comparison is
 * between two real paths. Returns `null` when unset, meaning no sandbox.
 *
 * Throws rather than falling back: a root that was meant to confine reads but silently did not
 * would be worse than no root at all, because it would be believed.
 */
export async function resolveSandbox(raw: string | undefined): Promise<string | null> {
  const v = (raw ?? '').trim();
  if (!v) return null;

  if (!isAbsolute(v)) {
    throw new Error(
      `CLICKUP_ATTACH_ROOT must be an absolute path, got ${JSON.stringify(v)}. ` +
        `A relative root would depend on the server's working directory.`,
    );
  }

  let real: string;
  try {
    real = await realpath(v);
  } catch {
    throw new Error(`CLICKUP_ATTACH_ROOT=${JSON.stringify(v)} does not exist.`);
  }

  const st = await stat(real);
  if (!st.isDirectory()) {
    throw new Error(`CLICKUP_ATTACH_ROOT=${JSON.stringify(v)} is not a directory.`);
  }
  return real;
}

/**
 * True when `child` is the root itself or genuinely beneath it.
 *
 * The separator matters: a bare `startsWith` would accept `/srv/uploads-evil` for a root of
 * `/srv/uploads`, which is a prefix but not a parent.
 */
function contains(root: string, child: string): boolean {
  if (child === root) return true;
  const base = root.endsWith(sep) ? root : root + sep;
  return child.startsWith(base);
}

export interface LocalFile {
  bytes: Buffer;
  /** The canonical path actually read, after `..` and symlink resolution. */
  realPath: string;
}

/**
 * Read a local file, subject to the sandbox.
 *
 * Every local read in this server goes through here. Tools do not call `readFile` directly, so
 * a future tool that wants a local file inherits the boundary instead of quietly reopening the
 * hole. Denials carry `code: 'policy'` so they propagate like every other capability refusal
 * rather than being folded into a partial-failure report.
 *
 * Residual risk, stated honestly: between the `realpath` check and the read, a local attacker
 * who can already write inside the root could swap a symlink. Closing that needs an open/fstat
 * pair; it is not worth the complexity here, because an attacker with local write access inside
 * the sandbox has easier paths than racing this window.
 */
export async function readLocalFile(
  filePath: string,
  root: string | null,
): Promise<LocalFile> {
  const abs = resolve(filePath);

  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    throw new ClickUpToolError({
      what: `Could not read ${filePath}.`,
      fix: root
        ? `Give a path to an existing file inside ${root}.`
        : 'Give an absolute path to a file this server can read.',
      origin: err instanceof Error ? err.message : String(err),
    });
  }

  if (root !== null && !contains(root, real)) {
    const resolvedNote = real === abs ? '' : ` It resolves to ${real}.`;
    throw new ClickUpToolError({
      what: `${filePath} is outside the directory this server may read files from.${resolvedNote}`,
      fix:
        `Attachments must be inside ${root} (set by CLICKUP_ATTACH_ROOT). This is a ` +
        `deliberate capability limit, not a filesystem permissions problem — the file was ` +
        `never opened and nothing was sent. Copy the file into that directory, or run a ` +
        `connection with a wider sandbox.`,
      code: 'policy',
    });
  }

  // Read the path that was checked, not the one that was passed, so the bytes provably come
  // from the file the containment test approved.
  const bytes = await readFile(real);
  return { bytes, realPath: real };
}
