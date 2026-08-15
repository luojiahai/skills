#!/usr/bin/env node

// Generates .claude-plugin/plugin.json's skills array from what is actually in
// skills/, and lints the tree on the way past. Run with --check in CI: a PR
// that retires a skill without regenerating goes red instead of shipping a
// skill the CLI has already stopped offering.
//
// The lint also covers ground `claude plugin validate . --strict` does not.
// That command stops at the JSON manifests — .claude-plugin/marketplace.json
// short-circuits it into the marketplace route — and a skill listed by a
// nested path is only existence-checked, so a SKILL.md with no description
// passes it today.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectSkills, lintSkills, pluginSkillPaths, warnSkills } from './skill-manifest.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = join(repo, '.claude-plugin', 'plugin.json');
const check = process.argv.includes('--check');

const skills = await collectSkills(repo);
const errors = lintSkills(skills);

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}

for (const warning of warnSkills(skills)) console.warn(`warning: ${warning}`);

const wanted = pluginSkillPaths(skills);
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));

if (JSON.stringify(plugin.skills) === JSON.stringify(wanted)) {
  console.log(`plugin.json lists ${wanted.length} published skills`);
  process.exit(0);
}

if (check) {
  console.error('error: plugin.json skills array is stale. Run `npm run sync:skills`.');
  console.error(`  listed: ${JSON.stringify(plugin.skills)}`);
  console.error(`  wanted: ${JSON.stringify(wanted)}`);
  process.exit(1);
}

plugin.skills = wanted;
writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`plugin.json skills -> ${JSON.stringify(wanted)}`);
