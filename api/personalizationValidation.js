// Reject the common short-bill failure where permission to spend existing
// program funds is rewritten as a promise of new money.
export function validateFundingClaims(parsed, billContent = '') {
  const source = String(billContent).toLowerCase()
  if (!/allowable use|permissible use|may be used for|use of funds/.test(source)) return parsed

  const output = [parsed.headline, parsed.summary, parsed.if_it_passes, parsed.if_it_fails]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/\b(new funding|provides? (?:new )?funding|receive (?:new )?funding|apply for (?:new )?(?:funding|grants?)|creates? (?:a )?(?:new )?(?:grant|funding program)|guarantees? funding)\b/.test(output)) {
    throw new Error('validation: allowable use of existing funds described as new funding')
  }
  return parsed
}
