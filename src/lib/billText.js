const HEADING_RE = /^(?:(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[\w.-]+)/
const PROVISION_RE = /^(?:``|["“])?(?:\([a-z0-9]{1,4}\)|\d+[.)])\s+/i
const SECTION_RE = /^(SECTION|SEC)\.?\s+(\d+[A-Za-z0-9.-]*?)\.\s*(.*)$/i
const CAPS_TITLE_RE = /^([A-Z][A-Z0-9 ,&'’()/.:-]*\.)(?:\s+(.+))?$/
const FRONT_MATTER_RE = /^(IN THE (?:SENATE|HOUSE) OF THE UNITED STATES|A BILL|AN ACT)(?:\s+(.+))?$/
// "119th CONGRESS 2d Session S. 5178" — note Congress prints "2d", not "2nd".
const MASTHEAD_RE = /^(\d+(?:st|nd|rd|th|d) CONGRESS)\s+(\d+(?:st|nd|rd|th|d) Session)\s+((?:[A-Z]\.\s?){1,4}\s*\d+)\b/

/**
 * The enumerator ladder legislative drafters use, outermost first. Congress and
 * every state that follows the same house style nest provisions in this fixed
 * order, and the printed source expresses the nesting purely through leading
 * indentation. Our stored copies are whitespace-collapsed, so the marker itself
 * is the only surviving signal of depth — see resolveDepth below.
 */
const LADDER = [
  { kind: 'lower', first: 'a', re: /^[a-z]$/ },
  { kind: 'digit', first: '1', re: /^\d{1,3}$/ },
  { kind: 'upper', first: 'A', re: /^[A-Z]$/ },
  { kind: 'roman', first: 'i', re: /^[ivxl]{1,6}$/ },
  { kind: 'ROMAN', first: 'I', re: /^[IVXL]{1,6}$/ },
  { kind: 'double', first: 'aa', re: /^[a-z]{2,3}$/ },
]
const RANK = Object.fromEntries(LADDER.map((entry, index) => [entry.kind, index]))

const ROMAN_SEQUENCE = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
  'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']

function kindsFor(symbol) {
  return LADDER.filter(entry => entry.re.test(symbol)).map(entry => entry.kind)
}

/** The marker that would come directly after `symbol` in the given sequence. */
function successorOf(kind, symbol) {
  if (kind === 'digit') return String(Number(symbol) + 1)
  if (kind === 'roman' || kind === 'ROMAN') {
    const lower = symbol.toLowerCase()
    const next = ROMAN_SEQUENCE[ROMAN_SEQUENCE.indexOf(lower) + 1]
    if (!next) return null
    return kind === 'ROMAN' ? next.toUpperCase() : next
  }
  if (kind === 'lower' || kind === 'upper') {
    if (symbol.length !== 1) return null
    // Drafters skip "l" and "o" only rarely; treating the alphabet as-is keeps
    // the successor test strict, and a miss simply falls through to rank.
    return String.fromCharCode(symbol.charCodeAt(0) + 1)
  }
  if (kind === 'double') {
    const next = String.fromCharCode(symbol.charCodeAt(0) + 1)
    return next.repeat(symbol.length)
  }
  return null
}

/**
 * Rebuild the nesting the printed bill shows through indentation.
 *
 * A marker is placed by walking the open levels from the inside out: if it is
 * the next marker in a level's own sequence it is a sibling at that level, if
 * it opens a sequence it becomes a new child level, and otherwise it falls back
 * to the ladder's canonical rank. The fallback matters because amendments quote
 * existing statute and therefore routinely start mid-sequence — "(9)" inserted
 * into a definitions list is a paragraph, not a subsection.
 */
function createDepthTracker() {
  let stack = []
  return {
    reset() { stack = [] },
    /**
     * Whether this marker takes its place in the ladder on its own terms —
     * continuing an open level or opening a new one. A marker that only fits by
     * falling back to canonical rank is more likely a cross-reference, so
     * callers deciding where to break text use this rather than depthFor.
     */
    accepts(symbol) {
      if (stack.some(level => successorOf(level.kind, level.last) === symbol)) return true
      return kindsFor(symbol).some(kind => LADDER[RANK[kind]].first === symbol)
    },
    depthFor(symbol) {
      for (let index = stack.length - 1; index >= 0; index--) {
        const level = stack[index]
        if (successorOf(level.kind, level.last) === symbol) {
          stack = stack.slice(0, index + 1)
          level.last = symbol
          return index
        }
      }
      const kinds = kindsFor(symbol)
      const opener = kinds.find(kind => LADDER[RANK[kind]].first === symbol)
      if (opener) {
        // The ladder alternates kinds, so "(a)" is never nested inside another
        // lettered subsection. Arriving at one while that level is already open
        // means a new quoted statute is restarting it, not descending.
        const openAt = stack.findIndex(level => level.kind === opener)
        if (openAt >= 0) stack = stack.slice(0, openAt)
        stack.push({ kind: opener, last: symbol })
        return stack.length - 1
      }
      const kind = kinds[0]
      if (!kind) return stack.length ? stack.length - 1 : 0
      const depth = Math.min(RANK[kind], stack.length)
      stack = stack.slice(0, depth)
      stack.push({ kind, last: symbol })
      return stack.length - 1
    },
  }
}

/**
 * Remove print-layout debris from text extracted from GPO bill PDFs. In those
 * files the margin line number can land inside a wrapped word ("Tech-18
 * nology"), while each page injects a VerDate footer and document marker.
 * Keep this deliberately gated by those unmistakable markers so real bill
 * numbers in normal HTML/plain-text exports are never touched.
 */
function cleanGpoPdfArtifacts(source) {
  const hasGpoPageFurniture = /\bVerDate\s+Sep\s+11\s+2014\b/i.test(source)
    || /[—–-]\s*\d+\s+of\s+\d+\s*[—–-]/i.test(source)
  if (!hasGpoPageFurniture) return source

  return source
    // A printed margin number can be attached to a line-ending hyphen.
    .replace(/([A-Za-z])-\s*(?:[1-9]|1\d|2[0-5])\s+([a-z])/g, '$1$2')
    // The same margin number can sit between a coordinating word and the
    // first word on the next printed line.
    .replace(/\b(and|or)\s+(?:[1-9]|1\d|2[0-5])\s+(?=[A-Za-z“‘])/gi, '$1 ')
    // Drop the complete GPO production footer, including the final line
    // number printed immediately before it. Leave a marker temporarily so we
    // can remove the first line number after the page break as well.
    .replace(
      /\s+(?:[1-9]|1\d|2[0-5])\s+VerDate\b[\s\S]*?\bwith\s+\$\$_JOB\b/gi,
      ' <GPO_PAGE_BREAK> '
    )
    .replace(/\bVerDate\b[\s\S]*?\bwith\s+\$\$_JOB\b/gi, ' <GPO_PAGE_BREAK> ')
    // Printed page count and document slug, for example
    // "— 5 of 72 — 6 •S 2511 RS".
    .replace(/[—–-]\s*\d+\s+of\s+\d+\s*[—–-]\s*(?:\d+\s*)?[•●]\s*[A-Z]\s*\d+\s+[A-Z]{1,4}\b/gi, ' ')
    // Line numbering restarts at 1 after the page furniture. It usually
    // appears after the first short run of prose on the new page.
    .replace(/<GPO_PAGE_BREAK>((?:(?![.!?;]).){0,180}?)\s+1\s+(?=[a-z])/gi, '$1 ')
    .replace(/<GPO_PAGE_BREAK>/g, ' ')
}

/**
 * State legislatures print a running header on every page. Connecticut's is the
 * most invasive of the ones we ingest: it lands mid-sentence in the extracted
 * text, in the middle of the very clause a student is trying to read. Every
 * variant is anchored on the unmistakable "-- 4 of 11 --" page counter, so this
 * cannot chew through ordinary bill prose.
 */
function cleanStatePageFurniture(source) {
  const billDesignation = String.raw`(?:(?:Substitute|Proposed|Raised|Amended|Emergency|Committee|Senate|House)\s+)*Bill\s+No\.\s*\d+\w*\s*`
  const pageHeader = new RegExp(
    String.raw`\s*[-–—]{1,2}\s*\d+\s+of\s+\d+\s*[-–—]{1,2}\s*`
    + String.raw`(?:${billDesignation})?`
    + String.raw`(?:Public\s+Act\s+No\.\s*[\d-]+\s*)?`
    // "LCO No. 2937 2 of 3" carries a drafting-office number before the page
    // count; "LCO 6 of 11" omits it. The lookahead keeps the first number from
    // being eaten as the office number when it is really the page count.
    + String.raw`(?:LCO\s+(?:No\.\s*)?(?:\d+\s+(?!of\b))?)?`
    + String.raw`(?:\d+\s+of\s+\d+\s*)?`,
    'gi'
  )
  return source
    .replace(pageHeader, ' ')
    // The cover page repeats the drafting-office number alongside a page count.
    .replace(/\bLCO\s+(?:No\.\s*)?\d+\s+\d+\s+of\s+\d+\s*/gi, ' ')
    .replace(/\bLCO\s+(?:No\.\s*)?\d+\s+of\s+\d+\s*/gi, ' ')
    .replace(/\bLCO\s+(?:No\.\s*)?\d+\s*/gi, ' ')
}

/**
 * Strip the margin line numbers that legislative printers set beside every
 * printed line and that text extraction drops into the prose ("exempt from
 * taxation 4 under Section 501(c)(3)").
 *
 * Removing every bare integer would destroy real statutory references, so this
 * only removes numbers that belong to a long, strictly consecutive run spaced
 * like printed lines. Statutory citations never form a 1, 2, 3, ... chain at
 * regular word intervals, which makes the run itself the evidence.
 */
function stripPrintLineNumbers(source) {
  const tokens = source.split(' ')
  const numbers = []
  for (let index = 0; index < tokens.length; index++) {
    if (/^\d{1,4}$/.test(tokens[index])) numbers.push({ index, value: Number(tokens[index]) })
  }
  if (numbers.length < 10) return source

  const MIN_RUN = 8
  const MIN_GAP = 2
  const MAX_GAP = 40
  const drop = new Set()

  let start = 0
  while (start < numbers.length) {
    const run = [numbers[start]]
    let cursor = start
    for (let next = start + 1; next < numbers.length; next++) {
      const candidate = numbers[next]
      const current = numbers[cursor]
      if (candidate.value !== current.value + 1) continue
      const gap = candidate.index - current.index
      if (gap < MIN_GAP || gap > MAX_GAP) continue
      run.push(candidate)
      cursor = next
    }
    if (run.length >= MIN_RUN) {
      for (const entry of run) drop.add(entry.index)
      start = numbers.indexOf(run[run.length - 1]) + 1
    } else {
      start++
    }
  }

  if (!drop.size) return source
  return tokens.filter((_, index) => !drop.has(index)).join(' ')
}

// Words that introduce a cross-reference rather than a new provision, so
// "subdivision (2) of section 12-411" is never mistaken for the next item.
const REFERENCE_WORDS = /^(?:sections?|subsections?|subdivisions?|subparagraphs?|paragraphs?|clauses?|subclauses?|chapters?|titles?|parts?|items?|divisions?)$/i

// A provision can open on a run of markers when a level has a single child —
// "(A)(i)" cites one place, and drafters print the pair together. The optional
// bracket is a state repeal opening on the same provision.
const LEADING_MARKERS_RE = /^(\[?)((?:\([A-Za-z0-9]{1,4}\)\s+){1,3})/

/**
 * Break out the provisions that the printed bill runs together inside a single
 * paragraph — Connecticut in particular sets whole lettered and numbered lists
 * as running prose. A marker only breaks the line when it takes its own place
 * in the ladder and is not introduced by a cross-referencing word, so
 * "subdivision (2) of this subsection" stays in the sentence it belongs to.
 */
function splitInlineSiblings(line) {
  const head = line.match(LEADING_MARKERS_RE)
  if (!head) return [line]

  const ladder = createDepthTracker()
  // Register every marker a provision opens on and report where its text
  // starts, so a run like "(A) (i)" leaves the ladder ready to recognise "(ii)".
  const openLadderAt = (position) => {
    const rest = line.slice(position)
    const lead = rest.match(/^\s*/)[0].length
    const run = rest.slice(lead).match(LEADING_MARKERS_RE)
    if (!run) return position + lead
    for (const marker of run[2].match(/\([A-Za-z0-9]{1,4}\)/g)) ladder.depthFor(marker.slice(1, -1))
    return position + lead + run[0].length
  }

  const parts = []
  // A marker may be followed by prose or, where a subparagraph opens straight
  // onto its first clause, by the next marker down — "shall enroll (A) (i)".
  const candidates = /(\S+)\s+\(([A-Za-z0-9]{1,4})\)\s+(?=[A-Za-z“]|\([A-Za-z0-9]{1,4}\)\s)/g
  candidates.lastIndex = openLadderAt(0)
  let start = 0
  let match

  while ((match = candidates.exec(line)) !== null) {
    const [, precedingWord, symbol] = match
    if (REFERENCE_WORDS.test(precedingWord) || !ladder.accepts(symbol)) continue
    const cut = match.index + precedingWord.length
    parts.push(line.slice(start, cut).trim())
    start = cut
    candidates.lastIndex = openLadderAt(cut)
  }

  parts.push(line.slice(start).trim())
  return parts.filter(Boolean)
}

function isHeading(line) {
  if (HEADING_RE.test(line)) return true
  // Legislative exports often represent headings only through capitalization.
  // Avoid treating short labels such as "IN" or page furniture as headings.
  const letters = line.replace(/[^a-z]/gi, '')
  return line.length <= 140 && letters.length >= 5 && letters === letters.toUpperCase()
}

/**
 * Connecticut and several other states mark language being repealed by wrapping
 * it in square brackets. Turn those spans into inline runs so the reader can
 * strike them the way the printed bill does, instead of showing raw brackets.
 */
function splitBracketedRuns(text, openBefore) {
  const runs = []
  let open = openBefore
  let buffer = ''
  for (const char of text) {
    if (char === '[' && !open) {
      if (buffer) runs.push({ text: buffer, struck: false })
      buffer = ''
      open = true
      continue
    }
    if (char === ']' && open) {
      if (buffer) runs.push({ text: buffer, struck: true })
      buffer = ''
      open = false
      continue
    }
    buffer += char
  }
  if (buffer) runs.push({ text: buffer, struck: open })
  return { runs, open }
}

/**
 * Turn plain-text legislative exports into readable semantic blocks.
 *
 * Source documents arrive either hard-wrapped at the printed line or, more
 * often in our storage, with every newline collapsed away. Either way the
 * printed layout is the only thing that carried the bill's structure, so this
 * rebuilds it: section boundaries, the enumerator nesting (see resolveDepth),
 * quoted statutory insertions, and struck language.
 */
export function formatBillText(text = '') {
  const raw = String(text)
  const looksStatePrinted = /[-–—]{1,2}\s*\d+\s+of\s+\d+\s*[-–—]{1,2}/.test(raw)
    || /\bLCO\s+(?:No\.\s*)?\d+\b/i.test(raw)
  // Bracketed repeals are a state drafting convention. Gate on it so federal
  // text, where brackets mean something else entirely, is never restyled.
  const usesBracketedRepeals = looksStatePrinted
    || /Be it enacted by the Senate and House of Representatives in General Assembly/i.test(raw)

  let working = cleanGpoPdfArtifacts(raw)
  if (looksStatePrinted) working = cleanStatePageFurniture(working)
  working = stripPrintLineNumbers(working)

  const normalized = working
    // GPO plain-text exports sometimes arrive HTML-encoded even though the
    // response itself is text. Decode only the small safe entity set used by
    // these documents; React still escapes the resulting strings on render.
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/‘‘/g, '“')
    .replace(/’’/g, '”')
    // Convert the typewriter em dash up front: the provision splits below key
    // off sentence punctuation, and "Effects.-- (1)" ends in a hyphen until
    // this runs.
    .replace(/--/g, '—')
    .replace(/<\/?DOC>/gi, '')
    // GPO closes every bill with an end-of-document marker.
    .replace(/<all>\s*$/i, '')
    .replace(/<DELETED>/gi, '\n<DELETED>')
    .replace(/<\/DELETED>/gi, '</DELETED>\n')
    .replace(/_{8,}/g, '\n')
    // Some GPO documents contain no newline characters at all. Recover the
    // strongest structural boundaries before doing the normal line pass.
    // The printed masthead sits on the same collapsed line as the export
    // header that precedes it.
    .replace(/\s+(?=\d+(?:st|nd|rd|th) CONGRESS\b)/g, '\n')
    .replace(/\s+(?=(?:SECTION|SEC\.)\s+\d+[A-Z0-9.-]*[.\s])/g, '\n')
    // States print the same label in mixed case. Requiring both a sentence
    // boundary before it and a period straight after the number keeps ordinary
    // cross-references ("in section 12-81 of the general statutes") intact.
    .replace(/(?<=[.,:;”’")\]])\s+(?=(?:Section|Sec\.)\s+\d+[a-z]?\.)/g, '\n')
    .replace(/\s+(?=(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[IVXLCDM\d]+\b)/g, '\n')
    .replace(/\s+(?=(?:``|“)\([A-Za-z0-9]{1,4}\)\s+)/g, '\n')
    // A marker that follows sentence-ending punctuation, a dash, or a colon
    // opens a new provision. References inside a sentence ("subsection (k) the
    // following") are preceded by a word, so they stay put. A state repeal
    // bracket can sit between the two.
    .replace(/(?<=[—:;.])\s+(?:(?:and|or)\s+)?(?=\[?\([A-Za-z0-9]{1,4}\)\s+)/g, '\n')
    .replace(/\s+(?=\[?\([A-Za-z]{1,4}\)\s+[A-Z])/g, '\n')
    .replace(/\s+(?=(?:IN THE (?:SENATE|HOUSE)|A BILL\b|AN ACT\b|Be it enacted\b))/g, '\n')

  const lines = normalized
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .split('\n')
    .flatMap(line => (line.trim() ? splitInlineSiblings(line.trim()) : [line]))

  const blocks = []
  const depths = createDepthTracker()
  let paragraph = []
  let paragraphType = 'paragraph'
  let paragraphDeleted = false
  let paragraphDepth = 0
  let paragraphMarker = ''
  let paragraphQuoted = false
  let inDeleted = false
  let bracketOpen = false

  const push = (block) => {
    if (!usesBracketedRepeals) {
      blocks.push(block)
      return
    }
    const { runs, open } = splitBracketedRuns(block.text, bracketOpen)
    bracketOpen = open
    const plain = runs.map(run => run.text).join('').replace(/\s+/g, ' ').trim()
    // A state section heading is only a label ("Sec. 2.") with no title after
    // it, so an empty body is not an empty block.
    if (!plain && !block.marker) return
    blocks.push(runs.some(run => run.struck)
      ? { ...block, text: plain, runs }
      : { ...block, text: plain })
  }

  const flushParagraph = () => {
    if (!paragraph.length) return
    const joinedText = paragraph.join(' ')
      .replace(/\s+/g, ' ')
      .replace(/(\w)-\s+(?!(?:and|or)\b)(?=\w)/g, '$1-')
      .replace(/\s+Calendar No\.\s+\d+.*$/i, '')
      .trim()
    const blockType = paragraphType === 'paragraph' && /^\[Congressional Bills\b/i.test(joinedText)
      ? 'metadata'
      : paragraphType
    if (joinedText) {
      push({
        type: blockType,
        text: joinedText,
        ...(paragraphMarker ? { marker: paragraphMarker } : {}),
        ...(blockType === 'provision' ? { depth: paragraphDepth } : {}),
        ...(paragraphQuoted ? { quoted: true } : {}),
        ...(paragraphDeleted ? { deleted: true } : {}),
      })
    }
    paragraph = []
    paragraphType = 'paragraph'
    paragraphDeleted = false
    paragraphDepth = 0
    paragraphMarker = ''
    paragraphQuoted = false
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
      .replace(/``/g, '“')
      .replace(/''/g, '”')
      // GPO sets a nested single quote as a backtick/apostrophe pair. Left raw
      // it reads as stray code punctuation: The term `rule'.
      .replace(/`([^`'"“”]{1,120}?)'/g, '‘$1’')
      .replace(/--/g, '—')
      .replace(/(\w)-\s+(?!(?:and|or)\b)(?=\w)/g, '$1-')

    // A quotation mark opening a marker means the provision is language being
    // written into existing law, not an operative command of this bill.
    let quoted = false
    if (/^“\s*\([A-Za-z0-9]{1,4}\)/.test(line)) {
      quoted = true
      line = line.slice(1).trim().replace(/”(?=\.?$)/, '').replace(/\.\.$/, '.')
    }
    if (!line) {
      if (closesDeletion) inDeleted = false
      continue
    }

    // Printed page-number ornaments add noise without legislative meaning.
    if (/^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])$/.test(line)) continue

    const mastheadMatch = line.match(MASTHEAD_RE)
    if (mastheadMatch) {
      flushParagraph()
      push({
        type: 'masthead',
        text: `${mastheadMatch[3].replace(/\s+/g, ' ').trim()} · ${mastheadMatch[1]} · ${mastheadMatch[2]}`,
        ...(deleted ? { deleted: true } : {}),
      })
      // The long title is printed under the masthead and again under "A BILL".
      // Keeping only the second copy avoids showing a student the same
      // paragraph twice before the bill has begun.
      if (closesDeletion) inDeleted = false
      continue
    }

    const frontMatterMatch = line.match(FRONT_MATTER_RE)
    if (frontMatterMatch) {
      flushParagraph()
      depths.reset()
      // "A BILL" stands alone above the long title federally, but a state bill's
      // "AN ACT CONCERNING ..." is itself the title and must not be cut in two.
      const standsAlone = frontMatterMatch[1] !== 'AN ACT'
      push({
        type: 'display',
        text: standsAlone ? frontMatterMatch[1] : line,
        ...(deleted ? { deleted: true } : {}),
      })
      if (standsAlone && frontMatterMatch[2]) {
        paragraphDeleted = deleted
        paragraph.push(frontMatterMatch[2])
      }
      if (closesDeletion) inDeleted = false
      continue
    }

    if (/^Be it enacted\b/i.test(line)) {
      flushParagraph()
      depths.reset()
      push({ type: 'enacting', text: line, ...(deleted ? { deleted: true } : {}) })
      if (closesDeletion) inDeleted = false
      continue
    }

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      flushParagraph()
      depths.reset()
      // Keep the source's own casing: Congress prints "SEC. 2." and state
      // drafting offices print "Sec. 2.".
      const label = `${/^SEC$/i.test(sectionMatch[1]) ? `${sectionMatch[1]}.` : sectionMatch[1]} ${sectionMatch[2]}.`
      const rest = sectionMatch[3] || ''
      const capsTitle = rest.match(CAPS_TITLE_RE)
      // Congress prints an all-caps section title; state drafters run straight
      // into the operative sentence, so the label stands alone there.
      if (capsTitle) {
        push({ type: 'heading', level: 2, marker: label, text: capsTitle[1], ...(deleted ? { deleted: true } : {}) })
        if (capsTitle[2]) {
          paragraphDeleted = deleted
          paragraph.push(capsTitle[2])
        }
      } else {
        push({ type: 'heading', level: 2, marker: label, text: '', ...(deleted ? { deleted: true } : {}) })
        if (rest) {
          paragraphDeleted = deleted
          paragraph.push(rest)
        }
      }
      if (closesDeletion) inDeleted = false
      continue
    }

    if (isHeading(line)) {
      flushParagraph()
      depths.reset()
      push({ type: 'heading', level: 1, text: line, ...(deleted ? { deleted: true } : {}) })
      if (closesDeletion) inDeleted = false
      continue
    }

    // A repeal bracket can open immediately before the marker. Hold onto it so
    // the run splitter still sees where the struck language starts.
    const provisionMatch = line.match(LEADING_MARKERS_RE)
    if (provisionMatch || PROVISION_RE.test(line)) {
      flushParagraph()
      paragraphType = 'provision'
      paragraphDeleted = deleted
      paragraphQuoted = quoted
      if (provisionMatch) {
        const markers = provisionMatch[2].match(/\([A-Za-z0-9]{1,4}\)/g)
        // The run descends the ladder; the provision sits at the innermost.
        for (const marker of markers) paragraphDepth = depths.depthFor(marker.slice(1, -1))
        paragraphMarker = markers.join('')
        paragraph.push(provisionMatch[1] + line.slice(provisionMatch[0].length))
      } else {
        paragraph.push(line)
      }
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
