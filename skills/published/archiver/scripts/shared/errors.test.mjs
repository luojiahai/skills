/**
 * The one thing about the code table a test can catch and a reader cannot:
 * whether it still agrees with the schema beside it.
 *
 * The table itself needs no test. A code emitted from anywhere is validated
 * against `output.schema.json` by the test helper, and one that is not in
 * `ERROR_EXITS` throws at `exitFor` — so drift is caught in both directions for
 * any code some test exercises. This covers the rest: a code added to one file
 * and forgotten in the other, with nothing yet reaching it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ERROR_EXITS } from './errors.mjs';
import { OUTPUT_SCHEMA } from '../testing.mjs';

test('the schema enumerates exactly the codes the table maps', () => {
  assert.deepEqual(
    [...OUTPUT_SCHEMA.$defs.error.properties.code.enum].sort(),
    Object.keys(ERROR_EXITS).sort(),
  );
});
