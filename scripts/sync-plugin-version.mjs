#!/usr/bin/env node

// Claude Code decides whether an installed user sees an update from the
// `version` in .claude-plugin/plugin.json, but changesets only ever bumps
// package.json's. Run after `changeset version` so the bot's version PR
// carries both bumps — a hand-synced version is one forgotten edit away from
// a release nobody receives.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(repo, ".claude-plugin", "plugin.json");

const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));

if (plugin.version === version) {
  console.log(`plugin.json already at ${version}`);
  process.exit(0);
}

const from = plugin.version;
plugin.version = version;
writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`plugin.json ${from} -> ${version}`);
