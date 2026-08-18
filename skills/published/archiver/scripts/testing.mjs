/**
 * testing.mjs — the seam every run-level test goes through.
 *
 * A good test here asserts what a command *returns*, not how it assembled it.
 * The document on stdout is the whole interface `SKILL.md` consumes, so tests
 * drive `main(argv, deps)` in-process, take the one document off stdout, and
 * assert its fields.
 *
 * Validation against `shared/output.schema.json` happens *inside* this helper
 * rather than in a conformance test of its own. That is deliberate: every
 * document every test produces is checked, so there is no way to add an emission
 * path that skips validation by being forgotten.
 *
 * Not a test file itself — `npm test` globs `*.test.mjs`, and this is the
 * machinery those import.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const OUTPUT_SCHEMA = JSON.parse(
  await readFile(path.join(HERE, 'shared', 'output.schema.json'), 'utf8'),
);

// ---- a validator for the subset this schema uses ---------------------------
// Small on purpose. The schema is the contract and this only has to be able to
// read it; a general JSON Schema implementation would be a dependency bought to
// check one file.

const TYPES = {
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
};

function resolve(schema, root) {
  if (!schema?.$ref) return schema;
  const parts = schema.$ref.replace(/^#\//, '').split('/');
  return parts.reduce((node, key) => (node == null ? undefined : node[key]), root);
}

/**
 * Every way `value` fails `schema`, as paths a failing test can be read from.
 *
 * A `$ref` that resolves to nothing is a failure of the schema, not a subtree
 * that happens to have no rules: were it read as the latter, one typo in
 * `output.schema.json` would make every assertion under that key vacuous while
 * the suite stayed green.
 */
function check(value, schema, root, where, problems) {
  const node = resolve(schema, root);
  if (!node) {
    problems.push(`${where}: unresolvable schema reference ${JSON.stringify(schema?.$ref ?? schema)}`);
    return problems;
  }

  if ('const' in node && value !== node.const) {
    problems.push(`${where}: expected ${JSON.stringify(node.const)}, got ${JSON.stringify(value)}`);
  }

  if (node.enum && !node.enum.some((option) => option === value)) {
    problems.push(`${where}: ${JSON.stringify(value)} is not one of ${JSON.stringify(node.enum)}`);
  }

  if (node.type) {
    const allowed = Array.isArray(node.type) ? node.type : [node.type];
    if (!allowed.some((name) => TYPES[name](value))) {
      problems.push(`${where}: expected ${allowed.join(' or ')}, got ${JSON.stringify(value)}`);
      return problems;
    }
  }

  if (node.anyOf) {
    const matched = node.anyOf.some((option) => check(value, option, root, where, []).length === 0);
    if (!matched) problems.push(`${where}: matches none of the permitted shapes — ${JSON.stringify(value)}`);
  }

  if (typeof value === 'number' && node.minimum !== undefined && value < node.minimum) {
    problems.push(`${where}: ${value} is below the minimum ${node.minimum}`);
  }

  if (TYPES.object(value)) {
    for (const key of node.required ?? []) {
      if (!(key in value)) problems.push(`${where}: missing required key ${JSON.stringify(key)}`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = node.properties?.[key];
      if (childSchema) check(child, childSchema, root, `${where}.${key}`, problems);
      else if (node.additionalProperties === false) problems.push(`${where}: unexpected key ${JSON.stringify(key)}`);
    }
  }

  if (Array.isArray(value) && node.items) {
    value.forEach((entry, index) => check(entry, node.items, root, `${where}[${index}]`, problems));
  }

  return problems;
}

/** Throws unless `document` conforms. Called on every document a test produces. */
export function validate(document, schema = OUTPUT_SCHEMA) {
  const problems = check(document, schema, schema, 'document', []);
  assert.equal(problems.join('\n'), '', `the emitted document does not match output.schema.json:\n${problems.join('\n')}`);
  return document;
}

/**
 * Runs a command's `main` with stdout and stderr captured, and returns
 * `{ code, document, stderr }`.
 *
 * Stdout must hold the one document and nothing else, so it is parsed whole
 * rather than scanned for something that looks like JSON — which is the property
 * being asserted as much as it is how the document is read. `--help` is the
 * documented exception and is asserted on `stdout` directly.
 */
export async function emitted(main, argv, deps) {
  const captured = await capture(() => (deps === undefined ? main(argv) : main(argv, deps)));
  const document = validate(JSON.parse(captured.stdout));

  assert.equal(document.exit, captured.code, 'the exit in the body must repeat the process exit code');
  assert.equal(document.ok, !document.error, 'error is present exactly when ok is false');

  return { ...captured, document };
}

/**
 * The same run without the document being parsed, for `--help` and for asserting
 * that stdout carried nothing.
 */
export async function capture(run) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  const write = process.stderr.write.bind(process.stderr);

  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => err.push(args.join(' '));
  process.stderr.write = (chunk) => (err.push(String(chunk)), true);

  try {
    const code = await run();
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    process.stderr.write = write;
  }
}
