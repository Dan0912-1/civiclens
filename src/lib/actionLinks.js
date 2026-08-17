export function splitActionText(text = '') {
  return String(text).split(/(https?:\/\/[^\s,)]+)/g).map(part => {
    if (!/^https?:\/\//i.test(part)) return { text: part, href: null, trailing: '' }
    const href = part.replace(/[.,;:!?]+$/, '')
    return { text: href, href, trailing: part.slice(href.length) }
  })
}

/**
 * The bill page has its own in-app document reader, so an AI-generated action
 * whose only job is to send the reader to the same bill text is redundant.
 * Keep this deliberately narrow: actions about tracking, discussing, or
 * researching a bill should still be shown.
 */
export function isReadBillAction(action = {}) {
  const title = String(action?.action || '').trim().toLowerCase()
  const allText = `${title} ${String(action?.how || '').toLowerCase()}`
  const startsWithReadingVerb = /^(read|view|open|review)\b/.test(title)
  const namesBillText = /\b(full\s+text|bill\s+text|text\s+of\s+the\s+bill|read\s+the\s+bill|view\s+the\s+bill)\b/.test(allText)
  return startsWithReadingVerb && namesBillText
}
