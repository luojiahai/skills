import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectSkills, lintSkills, parseFrontmatter, pluginSkillPaths } from './skill-manifest.mjs';

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

test('lintSkills rejects a published skill wearing the flag', async () => {
  const root = await fixture({
    'skills/published/alpha/SKILL.md': SKILL('name: alpha\ndescription: a\nmetadata:\n  internal: true'),
  });
  const errors = lintSkills(await collectSkills(root));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /published/);
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
