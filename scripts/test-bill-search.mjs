#!/usr/bin/env node
import assert from 'node:assert/strict'
import { parseBillNumberQuery, exactBillMatches } from '../api/billSearch.js'

const federal = parseBillNumberQuery('S. 5225', 'US')
assert.deepEqual(
  { type: federal.type, number: federal.number },
  { type: 's', number: 5225 }
)
assert.deepEqual(
  exactBillMatches([
    { type: 'hr', number: 5225 },
    { type: 's', number: 5225 },
    { type: 's', number: 225 },
  ], federal),
  [{ type: 's', number: 5225 }]
)

const state = parseBillNumberQuery('S 5225', 'CT')
assert.equal(state.type, 'sb')
assert.deepEqual(
  exactBillMatches([{ type: 'hb', number: 5225 }], state),
  [],
  'a missing state senate bill must not be substituted with a house bill'
)

assert.equal(parseBillNumberQuery('student loans', 'US'), null)
console.log('✓ exact bill-number search identity tests passed')
