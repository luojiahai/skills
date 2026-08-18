/**
 * The validator in `testing.mjs` is what every other test's schema assertion
 * rests on, so the way it can fail silently is worth its own test: a `$ref`
 * naming a definition that is not there must be an error, not a subtree with no
 * rules to check.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from './testing.mjs';

const schemaWithRef = (ref) => ({
  type: 'object',
  properties: { result: { $ref: ref } },
  $defs: { result: { type: 'object', required: ['count'] } },
});

test('a $ref naming nothing fails validation rather than passing vacuously', () => {
  assert.throws(
    () => validate({ result: { wrong: true } }, schemaWithRef('#/$defs/reslut')),
    /unresolvable schema reference/,
  );
});

test('a $ref that resolves still checks the subtree it names', () => {
  validate({ result: { count: 1 } }, schemaWithRef('#/$defs/result'));
  assert.throws(
    () => validate({ result: {} }, schemaWithRef('#/$defs/result')),
    /missing required key "count"/,
  );
});
