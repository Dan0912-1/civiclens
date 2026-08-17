#!/usr/bin/env node
import assert from 'node:assert/strict'
import { validateFundingClaims } from '../api/personalizationValidation.js'

const allowableUseText = 'Existing education program funds may be used for artificial intelligence literacy and training.'

assert.throws(
  () => validateFundingClaims({
    headline: 'Schools get new AI funding',
    summary: 'Your school can apply for new funding for AI classes.',
    if_it_passes: 'Schools receive funding.',
    if_it_fails: 'No grants are available.',
  }, allowableUseText),
  /existing funds described as new funding/
)

assert.doesNotThrow(() => validateFundingClaims({
  headline: 'Existing education funds could cover AI lessons',
  summary: 'The bill adds AI literacy as an allowable use of money already available through the program.',
  if_it_passes: 'Schools could choose to spend existing funds on AI literacy.',
  if_it_fails: 'Current allowable uses stay the same.',
}, allowableUseText))

console.log('✓ personalization funding-accuracy tests passed')
