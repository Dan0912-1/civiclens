const HEADING_RE = /^(?:(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[\w.-]+)/
const PROVISION_RE = /^(?:``|["“])?(?:\([a-z0-9]{1,4}\)|\d+[.)])\s+/i
const SECTION_WITH_TITLE_RE = /^((?:SECTION|SEC\.)\s+\d+[A-Z0-9.-]*\s+(?:[A-Z][A-Z0-9 ,&'’()/-]*\.)+)(?:\s+(.+))?$/
const FRONT_MATTER_RE = /^(IN THE (?:SENATE|HOUSE) OF THE UNITED STATES|A BILL)(?:\s+(.+))?$/

function isHeading(line) {
  if (HEADING_RE.test(line)) return true
  // Legislative exports often represent headings only through capitalization.
  // Avoid treating short labels such as "IN" or page furniture as headings.
  const letters = line.replace(/[^a-z]/gi, '')
  return line.length <= 140 && letters.length >= 5 && letters === letters.toUpperCase()
}

/**
 * Turn plain-text legislative exports into readable semantic blocks.
 * Source documents commonly hard-wrap every printed line; rendering them with
 * white-space: pre-wrap preserves those artificial breaks and makes the text
 * look like a damaged PDF. This rejoins wrapped prose while retaining section
 * headings, paragraph markers, and real blank-line boundaries.
 */
export function formatBillText(text = '') {
  const normalized = String(text)
    // GPO plain-text exports sometimes arrive HTML-encoded even though the
    // response itself is text. Decode only the small safe entity set used by
    // these documents; React still escapes the resulting strings on render.
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/<\/?DOC>/gi, '')
    .replace(/<DELETED>/gi, '\n<DELETED>')
    .replace(/<\/DELETED>/gi, '</DELETED>\n')
    .replace(/_{8,}/g, '\n')
    // Some GPO documents contain no newline characters at all. Recover the
    // strongest structural boundaries before doing the normal line pass.
    .replace(/\s+(?=(?:SECTION|SEC\.)\s+\d+[A-Z0-9.-]*\s)/g, '\n')
    .replace(/\s+(?=(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[IVXLCDM\d]+\b)/g, '\n')
    .replace(/\s+(?=``\([A-Za-z0-9]{1,4}\)\s+)/g, '\n')
    .replace(/\s+(?=\([A-Za-z0-9]{1,4}\)\s+(?:[A-Z]|by\b|the\b|an?\b|to\b|in\s+general\b))/g, '\n')
    .replace(/\s+(?=(?:IN THE (?:SENATE|HOUSE)|A BILL\b|Be it enacted\b))/g, '\n')

  const lines = normalized
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .split('\n')

  const blocks = []
  let paragraph = []
  let paragraphType = 'paragraph'
  let paragraphDeleted = false
  let inDeleted = false

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({
      type: paragraphType,
      text: paragraph.join(' ').replace(/\s+/g, ' ').trim(),
      ...(paragraphDeleted ? { deleted: true } : {}),
    })
    paragraph = []
    paragraphType = 'paragraph'
    paragraphDeleted = false
  }

  for (const rawLine of lines) {
    let line = rawLine.trim().replace(/\s+/g, ' ')
    if (!line) {
      flushParagraph()
      continue
    }

    const opensDeletion = /<DELETED>/i.test(line)
    const closesDeletion = /<\/DELETED>/i.test(line)
    if (opensDeletion) inDeleted = true
    const deleted = inDeleted
    line = line.replace(/<\/?DELETED>/gi, '').trim()
    if (!line) {
      if (closesDeletion) inDeleted = false
      continue
    }

    // Printed page-number ornaments add noise without legislative meaning.
    if (/^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])$/.test(line)) continue

    const frontMatterMatch = line.match(FRONT_MATTER_RE)
    if (frontMatterMatch) {
      flushParagraph()
      blocks.push({ type: 'heading', text: frontMatterMatch[1], ...(deleted ? { deleted: true } : {}) })
      if (frontMatterMatch[2]) {
        paragraphDeleted = deleted
        paragraph.push(frontMatterMatch[2])
      }
      if (closesDeletion) inDeleted = false
      continue
    }

    if (/^Be it enacted\b/i.test(line)) {
      flushParagraph()
      blocks.push({ type: 'enacting', text: line, ...(deleted ? { deleted: true } : {}) })
      if (closesDeletion) inDeleted = false
      continue
    }

    const sectionMatch = line.match(SECTION_WITH_TITLE_RE)
    if (sectionMatch) {
      flushParagraph()
      blocks.push({ type: 'heading', text: sectionMatch[1], ...(deleted ? { deleted: true } : {}) })
      if (sectionMatch[2]) {
        paragraphDeleted = deleted
        paragraph.push(sectionMatch[2])
      }
      if (closesDeletion) inDeleted = false
      continue
    }

    if (isHeading(line)) {
      flushParagraph()
      blocks.push({ type: 'heading', text: line, ...(deleted ? { deleted: true } : {}) })
      if (closesDeletion) inDeleted = false
      continue
    }

    if (PROVISION_RE.test(line)) {
      flushParagraph()
      paragraphType = 'provision'
      paragraphDeleted = deleted
      paragraph.push(line)
      if (closesDeletion) inDeleted = false
      continue
    }

    if (paragraph.length && paragraphDeleted !== deleted) flushParagraph()
    paragraphDeleted = deleted
    paragraph.push(line)
    // Keep unusually dense source documents from becoming a single enormous
    // paragraph when they contain no blank lines at all.
    if (paragraph.join(' ').length >= 900 && /[.!?;:]$/.test(line)) {
      flushParagraph()
    }
    if (closesDeletion) inDeleted = false
  }

  flushParagraph()
  return blocks
}
