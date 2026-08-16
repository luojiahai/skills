import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ARCHIVER_FILE, SCHEMA_VERSION, checkRoot, checkSchema, readSchema, stampRoot } from './archiver.mjs';
import { readJson } from './cli.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-archiver-root-'));

async function stamp(dir, contents) {
  await writeFile(path.join(dir, ARCHIVER_FILE), contents);
  return dir;
}

test('an unstamped root reads as absent, not as an error', async () => {
  assert.deepEqual(await readSchema(await root()), { present: false, schema: null });
});

test('a root that does not exist at all reads as absent', async () => {
  assert.deepEqual(await readSchema('/no/such/root'), { present: false, schema: null });
});

test('readSchema reports what the file said without judging it', async () => {
  const dir = await stamp(await root(), '{"schema":"two"}');
  assert.deepEqual(await readSchema(dir), { present: true, schema: 'two' });
});

test('an absent stamp is allowed, so a copied-out subtree still reads', () => {
  // The old flat layout also has no archiver.json, which is why this file is
  // never the guard against it — see the SCHEMA_VERSION comment.
  assert.equal(checkSchema({ present: false, schema: null }).ok, true);
});

test('the current schema is allowed', () => {
  assert.equal(checkSchema({ present: true, schema: SCHEMA_VERSION }).ok, true);
});

test('a newer schema is refused, and says so', () => {
  const verdict = checkSchema({ present: true, schema: SCHEMA_VERSION + 1 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /newer version/);
});

test('an older schema is refused too', () => {
  const verdict = checkSchema({ present: true, schema: SCHEMA_VERSION - 1 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /older version/);
});

test('a stamp that is present but not a number is refused, never ignored', () => {
  // Ignoring it would mean treating a corrupt root file as an absent one, and
  // absent means "carry on" — the one answer that must not be reached by
  // accident.
  for (const schema of ['2', null, 2.5, {}]) {
    assert.equal(checkSchema({ present: true, schema }).ok, false, `schema ${JSON.stringify(schema)}`);
  }
});

test('an unreadable stamp is not an absent one', async () => {
  // The one that matters. `absent` means "carry on", so anything collapsing into
  // it is a way of reaching the permissive answer by accident — a file truncated
  // by a full disk would read as no file at all, and the run would overwrite it
  // with a stamp claiming a schema nobody verified.
  for (const corrupt of ['', '{"schema":', 'not json at all', '[]', 'null']) {
    const dir = await stamp(await root(), corrupt);
    const found = await readSchema(dir);
    assert.equal(found.present, true, `${JSON.stringify(corrupt)} must not read as absent`);
    assert.equal(checkSchema(found).ok, false);
    await assert.rejects(() => checkRoot(dir), /archiver\.json/);
  }
});

test('checkRoot reads and never writes', async () => {
  // Stamping early would leave a mistyped --archives behind as a stamped empty
  // directory on a run that then went nowhere.
  const dir = await root();
  assert.equal(await checkRoot(dir), SCHEMA_VERSION);
  assert.equal(await readJson(path.join(dir, ARCHIVER_FILE)), null);
});

test('stampRoot stamps a root nobody has archived into', async () => {
  const dir = await root();
  assert.equal(await stampRoot(dir), SCHEMA_VERSION);
  assert.deepEqual(await readJson(path.join(dir, ARCHIVER_FILE)), { schema: SCHEMA_VERSION });
});

test('stampRoot leaves an already-stamped root alone', async () => {
  const dir = await stamp(await root(), `{"schema":${SCHEMA_VERSION},"note":"kept"}`);
  await stampRoot(dir);
  assert.equal((await readJson(path.join(dir, ARCHIVER_FILE))).note, 'kept');
});

test('checkRoot throws on a mismatch rather than returning a verdict to ignore', async () => {
  const dir = await stamp(await root(), `{"schema":${SCHEMA_VERSION + 1}}`);
  await assert.rejects(() => checkRoot(dir), /schema/);
});
