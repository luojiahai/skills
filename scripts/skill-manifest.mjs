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

function parseScalar(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? quoted[1] : value;
}

// Enough YAML for skill frontmatter: top-level scalars plus one level of
// nesting. Deliberately not a general parser — it exists to read `name`,
// `description` and `metadata.internal` exactly as the skills CLI reads them,
// including keeping a quoted "true" a string, since the CLI tests `=== true`.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;

  const data = {};
  let parent = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const nested = /^\s+([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (nested && parent) {
      data[parent][nested[1]] = parseScalar(nested[2]);
      continue;
    }

    const top = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!top) continue;

    if (top[2].trim() === '') {
      parent = top[1];
      data[parent] = {};
    } else {
      parent = null;
      data[top[1]] = parseScalar(top[2]);
    }
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
    const data = parseFrontmatter(await readFile(path.join(root, relPath), 'utf8'));
    const segments = relPath.split('/');
    const tiered = segments.length === 4 && TIERS.includes(segments[1]);
    const rawInternal = data?.metadata?.internal;

    return {
      relPath,
      dir: path.dirname(relPath),
      dirName: segments.at(-2),
      tier: tiered ? segments[1] : null,
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

    if (skill.tier === 'published' && skill.internal) {
      errors.push(`${skill.relPath}: a published skill must not carry metadata.internal`);
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

export function pluginSkillPaths(skills) {
  return skills
    .filter((skill) => skill.tier === 'published' && !skill.internal)
    .map((skill) => `./${skill.dir}`)
    .sort();
}
