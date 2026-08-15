// The single source of truth for which skills this repo ships.
//
// A skill is retired by adding `metadata.internal: true` to its SKILL.md
// frontmatter — that flag, and only that flag, is what stops the skills.sh CLI
// offering it. Directory placement does not: the CLI walks skills/ as a
// priority container and its fallback sweep recurses five levels through the
// whole tree, so a folder named deprecated/ hides nothing from it.
//
// The tiers under skills/ are therefore a human convention that this module
// promotes into a gate: lintSkills refuses any skill filed outside a tier, and
// requires tier and flag to agree, so "published" and "not flagged" cannot
// drift apart. .claude-plugin/plugin.json's skills array is generated from the
// result, because that array is additive — listing a skill there is the only
// thing it can do, and omitting one hides nothing.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git']);

export const TIERS = ['published', 'deprecated'];

// A real YAML parser reads these as booleans; the skills CLI tests `=== true`,
// so anything outside this set has to stay a string or the lint cannot tell a
// flag from a word that looks like one.
const BOOLEANS = new Map([
  ['true', true], ['True', true], ['TRUE', true],
  ['false', false], ['False', false], ['FALSE', false],
]);

export class FrontmatterError extends Error {}

function parseScalar(raw, line) {
  const value = raw.trim();

  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  if (quoted) return quoted[1];

  if (/^[|>]/.test(value)) {
    throw new FrontmatterError(`block scalars are not supported: ${line.trim()}`);
  }

  // In a plain scalar YAML starts a comment at " #", so dropping it is what a
  // real parser does — but only outside quotes, hence after the quoted check.
  const bare = value.replace(/\s+#.*$/, '').trim();
  return BOOLEANS.has(bare) ? BOOLEANS.get(bare) : bare;
}

// Enough YAML for skill frontmatter: top-level scalars plus one level of
// nesting, which is all `name`, `description` and `metadata.internal` need.
//
// It throws on everything else rather than guessing. Guessing is what makes a
// hand-rolled parser dangerous here: silently flattening a deeper `internal:`
// into `metadata.internal` would pass the lint while the CLI — reading real
// YAML — went on offering the skill, which is the one outcome this module
// exists to prevent. A parse it cannot vouch for is reported as a lint error.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;

  const data = {};
  let parent = null;
  let nestedIndent = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (line.trimStart().startsWith('- ')) {
      throw new FrontmatterError(`sequences are not supported: ${line.trim()}`);
    }

    const entry = /^(\s*)([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line);
    if (!entry) {
      throw new FrontmatterError(`cannot parse: ${line.trim()}`);
    }

    const [, indent, key, rawValue = ''] = entry;

    if (indent.length === 0) {
      if (rawValue.trim() === '') {
        parent = key;
        nestedIndent = null;
        data[key] = {};
      } else {
        parent = null;
        data[key] = parseScalar(rawValue, line);
      }
      continue;
    }

    if (parent === null) {
      throw new FrontmatterError(`unexpected indentation: ${line.trim()}`);
    }

    nestedIndent ??= indent.length;
    if (indent.length !== nestedIndent) {
      throw new FrontmatterError(`nesting deeper than one level is not supported: ${line.trim()}`);
    }
    if (rawValue.trim() === '') {
      throw new FrontmatterError(`nesting deeper than one level is not supported: ${line.trim()}`);
    }

    data[parent][key] = parseScalar(rawValue, line);
  }

  return data;
}

async function findSkillFiles(dir, root, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'SKILL.md') {
      found.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
      continue;
    }
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      await findSkillFiles(path.join(dir, entry.name), root, found);
    }
  }

  return found;
}

// Every SKILL.md under skills/, at any depth — a misfiled skill has to be seen
// before it can be rejected, and the CLI would see it.
export async function collectSkills(root) {
  const relPaths = await findSkillFiles(path.join(root, 'skills'), root, []);
  relPaths.sort();

  return Promise.all(relPaths.map(async (relPath) => {
    const text = await readFile(path.join(root, relPath), 'utf8');

    let data = null;
    let parseError = null;
    try {
      data = parseFrontmatter(text);
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error;
      parseError = error.message;
    }

    const segments = relPath.split('/');
    const tiered = segments.length === 4 && TIERS.includes(segments[1]);
    const rawInternal = data?.metadata?.internal;

    return {
      relPath,
      dir: path.dirname(relPath),
      dirName: segments.at(-2),
      tier: tiered ? segments[1] : null,
      parseError,
      hasFrontmatter: data !== null,
      name: typeof data?.name === 'string' ? data.name : null,
      description: typeof data?.description === 'string' ? data.description : null,
      rawInternal,
      internal: rawInternal === true,
    };
  }));
}

export function lintSkills(skills) {
  const errors = [];

  for (const skill of skills) {
    if (skill.parseError) {
      errors.push(`${skill.relPath}: ${skill.parseError}`);
      continue;
    }

    if (!skill.hasFrontmatter) {
      errors.push(`${skill.relPath}: no YAML frontmatter — a skill needs name and description`);
      continue;
    }

    for (const field of ['name', 'description']) {
      if (!skill[field]) {
        errors.push(`${skill.relPath}: missing ${field} in frontmatter`);
      }
    }

    if (skill.rawInternal !== undefined && typeof skill.rawInternal !== 'boolean') {
      errors.push(
        `${skill.relPath}: metadata.internal must be a YAML boolean, got ${JSON.stringify(skill.rawInternal)}` +
        ' — the skills CLI tests it with ===, so anything else ships the skill',
      );
    }

    if (skill.tier === null) {
      errors.push(
        `${skill.relPath}: every skill lives at skills/<${TIERS.join('|')}>/<name>/SKILL.md`,
      );
      continue;
    }

    if (skill.tier === 'deprecated' && !skill.internal) {
      errors.push(
        `${skill.relPath}: a deprecated skill needs metadata.internal: true` +
        ' — without it the skills CLI still offers it to install',
      );
    }
  }

  return errors;
}

// Flagging a skill retires it on its own: the CLI stops offering it and
// pluginSkillPaths drops it. Moving the folder into deprecated/ is the tidy-up
// that follows, and until it happens the skill has quietly left the plugin —
// so say so, rather than failing a build over a folder in the wrong place.
export function warnSkills(skills) {
  return skills
    .filter((skill) => skill.tier === 'published' && skill.internal)
    .map((skill) => (
      `${skill.relPath}: retired by metadata.internal but still in published/` +
      ' — it has dropped out of the plugin; git mv it into skills/deprecated/'
    ));
}

export function pluginSkillPaths(skills) {
  return skills
    .filter((skill) => skill.tier === 'published' && !skill.internal)
    .map((skill) => `./${skill.dir}`)
    .sort();
}
