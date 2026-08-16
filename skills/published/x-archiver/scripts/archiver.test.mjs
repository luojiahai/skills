import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ARCHIVER_FILE,
  SCHEMA_VERSION,
  checkRoot,
  checkSchema,
  readAliases,
  readSchema,
  stampRoot,
  writeAlias,
} from './archiver.mjs';
import { readJson } from './cli.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'x-archiver-root-'));

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
  const verdict = checkSchema({ present: true, schema: 1 });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /older version/);
});

test('schema 2 is readable, because every schema-2 folder is a legal schema-3 one', () => {
  // 2 → 3 moved nothing: it added aliases, and an archive with no aliases in it
  // is exactly a schema-2 archive. Refusing it would strand every existing
  // archive on a change that costs them nothing.
  assert.equal(checkSchema({ present: true, schema: 2 }).ok, true);
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
  assert.deepEqual(await readJson(path.join(dir, ARCHIVER_FILE)), { schema: SCHEMA_VERSION, accounts: {} });
});

test('stampRoot leaves an already-stamped root alone', async () => {
  const dir = await stamp(await root(), `{"schema":${SCHEMA_VERSION},"note":"kept"}`);
  await stampRoot(dir);
  assert.equal((await readJson(path.join(dir, ARCHIVER_FILE))).note, 'kept');
});

test('stampRoot upgrades a schema-2 root in place, keeping what it held', async () => {
  // Nothing moves. Every folder in a schema-2 archive is already a legal
  // un-aliased schema-3 folder, so the upgrade is the number and an empty map.
  const dir = await stamp(await root(), '{"schema":2,"note":"kept"}');
  assert.equal(await stampRoot(dir), SCHEMA_VERSION);
  assert.deepEqual(await readJson(path.join(dir, ARCHIVER_FILE)), {
    schema: SCHEMA_VERSION,
    note: 'kept',
    accounts: {},
  });
});

test('checkRoot throws on a mismatch rather than returning a verdict to ignore', async () => {
  const dir = await stamp(await root(), `{"schema":${SCHEMA_VERSION + 1}}`);
  await assert.rejects(() => checkRoot(dir), /schema/);
});

test('a root with no aliases reads as an empty map, not as an error', async () => {
  assert.deepEqual(await readAliases(await root(), 'x'), {});
  assert.deepEqual(await readAliases(await stamp(await root(), '{"schema":3}'), 'x'), {});
});

test('aliases are keyed by id and nested per platform', async () => {
  // Both skills write this one file, so an X "jia" and a Douyin "jia" have to be
  // able to coexist. Keyed by id because an object cannot then hold two aliases
  // for one account.
  const dir = await root();
  await writeAlias(dir, 'x', '55', 'jia');
  await writeAlias(dir, 'douyin', 'MS4wLjABAAAA', 'jia');

  assert.deepEqual(await readAliases(dir, 'x'), { 55: 'jia' });
  assert.deepEqual(await readAliases(dir, 'douyin'), { MS4wLjABAAAA: 'jia' });
  assert.equal((await readJson(path.join(dir, ARCHIVER_FILE))).schema, SCHEMA_VERSION);
});

test('writing an alias leaves the other platform, and unknown keys, alone', async () => {
  const dir = await stamp(await root(), '{"schema":3,"note":"kept","accounts":{"douyin":{"MS4w":"bee"}}}');
  await writeAlias(dir, 'x', '55', 'jia');

  const file = await readJson(path.join(dir, ARCHIVER_FILE));
  assert.equal(file.note, 'kept');
  assert.deepEqual(file.accounts.douyin, { MS4w: 'bee' });
  assert.deepEqual(file.accounts.x, { 55: 'jia' });
});

test('an alias can be taken back off, and the entry goes rather than emptying', async () => {
  const dir = await root();
  await writeAlias(dir, 'x', '55', 'jia');
  await writeAlias(dir, 'x', '55', null);
  assert.deepEqual(await readAliases(dir, 'x'), {});
});

test('a hand-edited mapping entry that is not two strings is ignored', async () => {
  // The file is a cache a human is invited to read, so it is also one a human
  // can mistype. A junk entry reads as no entry, which self-heals on the next
  // scan, rather than putting a number or a null into a path.
  const dir = await stamp(
    await root(),
    '{"schema":3,"accounts":{"x":{"55":"jia","66":null,"77":12,"88":"","":"nope"}}}',
  );
  assert.deepEqual(await readAliases(dir, 'x'), { 55: 'jia' });
});

test('a mapping that is not an object at all reads as no aliases', async () => {
  for (const junk of ['{"schema":3,"accounts":[]}', '{"schema":3,"accounts":"x"}', '{"schema":3,"accounts":{"x":[]}}']) {
    assert.deepEqual(await readAliases(await stamp(await root(), junk), 'x'), {});
  }
});

test('writeAlias upgrades a schema-2 root rather than writing a 2 with aliases in it', async () => {
  const dir = await stamp(await root(), '{"schema":2}');
  await writeAlias(dir, 'x', '55', 'jia');
  const file = await readJson(path.join(dir, ARCHIVER_FILE));
  assert.equal(file.schema, SCHEMA_VERSION);
  assert.deepEqual(file.accounts.x, { 55: 'jia' });
});
