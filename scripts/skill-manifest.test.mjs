import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectSkills,
  FrontmatterError,
  lintSkills,
  parseFrontmatter,
  pluginSkillPaths,
  warnSkills,
} from './skill-manifest.mjs';

const SKILL = (frontmatter) => `---\n${frontmatter}\n---\n\nBody text.\n`;

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-manifest-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}

test('parseFrontmatter reads the keys the manifest is built from', () => {
  const data = parseFrontmatter(SKILL([
    'name: alpha',
    'description: "A skill — with a colon: and an em dash."',
    'disable-model-invocation: true',
  ].join('\n')));
  assert.equal(data.name, 'alpha');
  assert.equal(data.description, 'A skill — with a colon: and an em dash.');
  assert.equal(data['disable-model-invocation'], true);
});

test('parseFrontmatter reads the nested metadata block', () => {
  const data = parseFrontmatter(SKILL('name: alpha\ndescription: d\nmetadata:\n  internal: true'));
  assert.deepEqual(data.metadata, { internal: true });
});

test('parseFrontmatter keeps a quoted "true" a string', () => {
  // The skills CLI tests `metadata?.internal === true`, so a quoted value is a
  // published skill wearing a retirement badge. The parser must not launder it
  // into a boolean, or lintSkills cannot catch it.
  const data = parseFrontmatter(SKILL('name: alpha\ndescription: d\nmetadata:\n  internal: "true"'));
  assert.equal(data.metadata.internal, 'true');
});

test('parseFrontmatter returns null when there is no frontmatter', () => {
  assert.equal(parseFrontmatter('# Just a heading\n'), null);
});

test('parseFrontmatter refuses nesting it cannot represent rather than flattening it', () => {
  // Flattening is the dangerous failure: a deeper `internal: true` read as
  // metadata.internal would satisfy the lint while the CLI, reading real YAML,
  // saw no flag and went on offering the skill.
  assert.throws(
    () => parseFrontmatter(SKILL('name: alpha\ndescription: d\nmetadata:\n  nested:\n    internal: true')),
    FrontmatterError,
  );
});

test('parseFrontmatter refuses block scalars rather than reading the indicator as the value', () => {
  assert.throws(() => parseFrontmatter(SKILL('name: alpha\ndescription: >-\n  a long description')), FrontmatterError);
});

test('parseFrontmatter refuses sequences and stray indentation', () => {
  assert.throws(() => parseFrontmatter(SKILL('name: alpha\ntools:\n- one')), FrontmatterError);
  assert.throws(() => parseFrontmatter(SKILL('name: alpha\n  orphaned: true')), FrontmatterError);
});

test('parseFrontmatter strips an inline comment from a plain scalar but not from a quoted one', () => {
  const data = parseFrontmatter(SKILL('name: alpha # the retired one\ndescription: "a # b"'));
  assert.equal(data.name, 'alpha');
  assert.equal(data.description, 'a # b');
});

test('parseFrontmatter reads the boolean casings a real YAML parser accepts', () => {
  // `True` is a boolean to the CLI's parser, so treating it as a string here
  // would report a flag that is genuinely doing its job as malformed.
  for (const literal of ['true', 'True', 'TRUE']) {
    const data = parseFrontmatter(SKILL(`name: a\ndescription: d\nmetadata:\n  internal: ${literal}`));
    assert.equal(data.metadata.internal, true, literal);
  }
});

test('lintSkills reports a frontmatter it could not parse', async () => {
  const root = await fixture({
    'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: d\nmetadata:\n  a:\n    internal: true'),
  });
  const errors = lintSkills(await collectSkills(root));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nesting deeper than one level/);
});

test('collectSkills finds every skill under skills/ and records its tier', async () => {
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a'),
    'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: b\nmetadata:\n  internal: true'),
    'skills/README.md': '# catalogue\n',
  });
  const skills = await collectSkills(root);
  assert.deepEqual(skills.map((s) => [s.tier, s.name, s.internal]), [
    ['deprecated', 'beta', true],
    ['published', 'alpha', false],
  ]);
});

test('collectSkills reaches a misfiled skill so the lint can reject it', async () => {
  // The CLI's fallback sweep recurses five levels, so anything we fail to see
  // here is still something it would happily offer to install.
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a'),
    'skills/loose/SKILL.md': SKILL('name: loose\ndescription: l'),
    'skills/published/nested/deeper/SKILL.md': SKILL('name: deeper\ndescription: d'),
  });
  const skills = await collectSkills(root);
  const misfiled = skills.filter((s) => s.tier === null).map((s) => s.relPath);
  assert.deepEqual(misfiled.sort(), [
    'skills/loose/SKILL.md',
    'skills/published/nested/deeper/SKILL.md',
  ]);
});

test('collectSkills ignores node_modules', async () => {
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a'),
    'skills/published/alpha/node_modules/pkg/SKILL.md': SKILL('name: vendored\ndescription: v'),
  });
  const skills = await collectSkills(root);
  assert.deepEqual(skills.map((s) => s.name), ['alpha']);
});

test('lintSkills passes a well-formed pair of tiers', async () => {
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a'),
    'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: b\nmetadata:\n  internal: true'),
  });
  assert.deepEqual(lintSkills(await collectSkills(root)), []);
});

test('lintSkills rejects a skill filed outside a tier', async () => {
  const root = await fixture({ 'skills/loose/SKILL.md': SKILL('name: loose\ndescription: l') });
  const errors = lintSkills(await collectSkills(root));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /skills\/loose\/SKILL\.md/);
  assert.match(errors[0], /published|deprecated/);
});

test('lintSkills rejects a skill missing the fields the CLI requires', async () => {
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha'),
    'skills/published/gamma/SKILL.md': '# no frontmatter at all\n',
  });
  const errors = lintSkills(await collectSkills(root));
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.includes('alpha') && e.includes('description')));
  assert.ok(errors.some((e) => e.includes('gamma') && e.includes('frontmatter')));
});

test('lintSkills rejects a retired skill that never got the flag', async () => {
  // This is the whole point of the exercise: an unflagged skill in deprecated/
  // is still offered by `skills add`, at any depth.
  const root = await fixture({ 'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: b') });
  const errors = lintSkills(await collectSkills(root));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /metadata\.internal/);
});

test('a published skill wearing the flag is a warning, not an error', async () => {
  // The flag alone retires: the CLI stops offering it and it drops out of the
  // plugin either way. Only the folder is in the wrong place, so failing the
  // build would make retirement two moves instead of one.
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a\nmetadata:\n  internal: true'),
  });
  const skills = await collectSkills(root);
  assert.deepEqual(lintSkills(skills), []);
  assert.equal(warnSkills(skills).length, 1);
  assert.match(warnSkills(skills)[0], /skills\/deprecated/);
  assert.deepEqual(pluginSkillPaths(skills), []);
});

test('lintSkills rejects a non-boolean internal flag', async () => {
  const root = await fixture({
    'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: b\nmetadata:\n  internal: "true"'),
  });
  const errors = lintSkills(await collectSkills(root));
  assert.ok(errors.some((e) => /boolean/.test(e)));
});

test('pluginSkillPaths lists the published skills, sorted, and nothing else', async () => {
  const root = await fixture({
    'skills/published/zulu/SKILL.md': SKILL('name: zulu\ndescription: z'),
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a'),
    'skills/deprecated/beta/SKILL.md': SKILL('name: beta\ndescription: b\nmetadata:\n  internal: true'),
  });
  assert.deepEqual(pluginSkillPaths(await collectSkills(root)), [
    './skills/published/alpha',
    './skills/published/zulu',
  ]);
});
