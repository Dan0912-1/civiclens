const HEADING_RE = /^(?:(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[\w.-]+)/
const PROVISION_RE = /^(?:``|["“])?(?:\([a-z0-9]{1,4}\)|\d+[.)])\s+/i
const SECTION_RE = /^(SECTION|SEC)\.?\s+(\d+[A-Za-z0-9.-]*?)\.\s*(.*)$/i
const CAPS_TITLE_RE = /^([A-Z][A-Z0-9 ,&'’()/.:-]*\.)(?:\s+(.+))?$/
// The House prints "IN THE HOUSE OF REPRESENTATIVES" where the Senate prints
// "IN THE SENATE OF THE UNITED STATES".
const FRONT_MATTER_RE = /^(IN THE (?:SENATE|HOUSE) OF (?:THE UNITED STATES|REPRESENTATIVES)|A BILL|AN ACT)(?:\s+(.+))?$/
// "119th CONGRESS 2d Session S. 5178" — note Congress prints "2d", not "2nd".
// A PDF printing sets the whole line in caps and opens it with the document
// class ("I", "III", "IV"), so both are allowed for here.
const MASTHEAD_RE = /^(?:[IV]{1,4}\s+)?(\d+(?:st|nd|rd|th|d) CONGRESS)\s+(\d+(?:st|nd|rd|th|d) SESSION)\s+((?:[A-Z]{1,4}\.\s?){1,4}\s*\d+)\b/i

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

// The running document slug GPO prints at the head of every page: a bullet,
// the bill's designation and its version code — "•S 2511 RS", "•HR 5442 IH",
// "•HRES 100 IH". The designation is not one letter: matching only "S" left the
// slug sitting mid-sentence on every House bill we serve.
const GPO_SLUG = String.raw`[•●]\s*[A-Z]{1,6}\.?\s*\d+\s+[A-Z]{1,4}\b`
// "-- 1 of 218 --" in the PDF extraction, "— 5 of 72 —" once the dashes have
// been typeset. Both dashes double, so the count either side must be optional.
const GPO_PAGE_COUNT = String.raw`[—–-]{1,2}\s*\d+\s+of\s+\d+\s*[—–-]{1,2}`
/**
 * The production footer that closes every printed page. Its middle names the
 * GPO operator who ran the typesetting job, and that differs from document to
 * document — "ssavage on LAPJG3WLY3PROD with BILLS" against "kjohnson on
 * DSK5ZCZBW7PROD with $$_JOB" — so anchoring on any one of them silently
 * leaves the whole footer in the text of every bill set by the other. Anchor
 * instead on the two ends that never vary: VerDate opens the footer, and the
 * print codes run through to the job path.
 */
const GPO_FOOTER = new RegExp(
  // The page's own last margin number is printed flush against the footer.
  String.raw`\s*(?:\d{1,2}\s+)?`
  + String.raw`VerDate\b[\s\S]{0,200}?\bSfmt\s+\d+\b`
  + String.raw`(?:\s+E:\\\S+\s+\S+)?`               // E:\BILLS\H5442.IH H5442
  // "ssavage on LAPJG3WLY3PROD with BILLS". The operator's name can extract
  // glued to the job name before it ("S2511kjohnson"), so it is optional here.
  + String.raw`(?:(?:\s+\S+)?\s+on\s+\S+\s+with\s+\S+)?`
  + String.raw`(?:\s*${GPO_PAGE_COUNT})?`
  // The next page's printed number, taken only when its slug follows: with no
  // slug to bound it this would eat the first real number on the page.
  + String.raw`(?:\s*\d{1,4}(?=\s*[•●]))?`
  + String.raw`(?:\s*${GPO_SLUG})?`,
  'gi'
)

/** Whether this text came out of a GPO bill PDF rather than an HTML printing. */
function isGpoPdfText(source) {
  // Gate on markers only a GPO PDF export carries. A bare "— 4 of 11 —" page
  // count is NOT one of them: state legislatures print the same counter, and
  // the hyphen repair below then eats their margin numbers out of ordinary
  // hyphenated words ("hand-harvesting of ... crabs or the eggs of 15").
  return /\bVerDate\s+\w{3}\s+\d{1,2}\s+\d{4}\b/i.test(source)
    || new RegExp(`${GPO_PAGE_COUNT}\\s*(?:\\d+\\s*)?${GPO_SLUG}`, 'i').test(source)
}

/**
 * Remove print-layout debris from text extracted from GPO bill PDFs. In those
 * files the margin line number can land inside a wrapped word ("Tech-18
 * nology"), while each page injects a VerDate footer and document marker.
 * Keep this deliberately gated by those unmistakable markers so real bill
 * numbers in normal HTML/plain-text exports are never touched.
 */
function cleanGpoPdfArtifacts(source) {
  if (!isGpoPdfText(source)) return source
  const compounds = collectCompounds(source)
  const words = collectWords(source)

  return source
    // Drop the complete footer, including the final line number printed
    // immediately before it. Leave a marker temporarily: it bounds the page,
    // whose line numbering starts over.
    .replace(GPO_FOOTER, ' <GPO_PAGE_BREAK> ')
    // A page can carry the count and slug without the footer, for example
    // "— 5 of 72 — 6 •S 2511 RS". Either half alone still marks the boundary.
    .replace(new RegExp(String.raw`${GPO_PAGE_COUNT}\s*(?:\d+\s*(?=[•●]))?(?:${GPO_SLUG})?`, 'gi'), ' <GPO_PAGE_BREAK> ')
    .replace(new RegExp(GPO_SLUG, 'gi'), ' <GPO_PAGE_BREAK> ')
    // The last line of a page can break a word, leaving its halves on either
    // side of the footer: "equal representation be-25 <footer> tween 2-year".
    // Rejoin the word and keep the page boundary just past it.
    .replace(
      /([A-Za-z]+)-\s*(?:\d{1,2}\s*)?<GPO_PAGE_BREAK>\s*([A-Za-z]+)/g,
      (whole, left, right) => (
        `${left}${compounds.has(`${left.toLowerCase()}-${right.toLowerCase()}`) ? '-' : ''}${right} <GPO_PAGE_BREAK> `
      )
    )
    // The masthead's ordinal is typeset in small caps and extracts split from
    // its number. Repair it before the count runs: left alone, the "1" of
    // "1 ST SESSION" reads as a bare margin number sitting above the page's
    // real first line.
    .replace(/\b(\d{1,3})\s+(ST|ND|RD|TH|D)\s+(?=SESSION\b|CONGRESS\b)/gi, '$1$2 ')
    // Now that pages are bounded, take out the margin numbers themselves.
    .replace(/[\s\S]+/, text => stripGpoMarginNumbers(text, compounds))
    .replace(/<GPO_PAGE_BREAK>/g, ' ')
    // Every number lifted out leaves the gap it sat in. Close them before the
    // repairs below, which read the word on either side of a single space.
    .replace(/[ \t]{2,}/g, ' ')
    // A small-caps word broken across a line keeps the printer's hyphen with a
    // space either side once extracted: "AVOIDING DUPLICATED REPORT - ING",
    // "APPROPRIATE CONGRESSIONAL COMMIT - TEES". Close it up unless the bill
    // writes the pair hyphenated somewhere it did not have to break.
    .replace(/\b([A-Z]{2,})\s+-\s+([A-Z]{2,})\b/g, (whole, left, right) => (
      compounds.has(`${left.toLowerCase()}-${right.toLowerCase()}`) ? `${left}-${right}` : left + right
    ))
    // Provision headings are typeset in small caps with a full-size initial,
    // and the extraction splits that initial off and drifts the closing period:
    // "E STABLISHMENT OF SYSTEM .—". Both halves are wrong the same way. The
    // dash is still in either form here — this runs before the em dash is
    // normalised — so match it by lookahead rather than reproducing it.
    .replace(/([A-Z])\s+\.\s*(?=—|--)/g, '$1.')
    .replace(/\b([A-Z]) ([A-Z][A-Z0-9 ,’'()–-]{0,80}?)\s*\.(?=—|--)/g, '$1$2.')
    // The same split outside a heading, where there is no "—" to bound it. A
    // member's name and a date are the two places it always lands, and both
    // sit in a shape too specific to catch anything else — "A BILL" has to
    // survive, so a bare capital before a word is not enough to go on.
    .replace(/\b(M(?:r|s|rs|essrs|iss)\.)\s+([A-Z])\s+([A-Z]{2,})/g, '$1 $2$3')
    .replace(/\b(M(?:r|s|rs|essrs|iss)\.\s+[A-Z]+)\s+([A-Z])\s+([A-Z]{2,})/g, '$1 $2$3')
    // A hyphenated surname splits at the hyphen as well: "Mrs. MILLER -M EEKS".
    .replace(/\b([A-Z]{2,})\s*-\s*([A-Z])\s+([A-Z]{2,})\b/g, '$1-$2$3')
    .replace(
      /\b([JFMASOND])\s+(ANUARY|EBRUARY|ARCH|PRIL|AY|UNE|ULY|UGUST|EPTEMBER|CTOBER|OVEMBER|ECEMBER)\b/g,
      '$1$2'
    )
    // Anywhere else inside a small-caps run, the bill itself decides: join the
    // initial back on only when the result is a word the document uses. That
    // keeps "COMPETITIVE W AGE" and "P ART C" whole while leaving the real
    // subpart letter in "PART D OF IDEA" alone.
    .replace(/(?<=\b[A-Z]{2,}\s|[“‘"]|\)\s|[.;:]\s)([A-Z])\s+([A-Z]{2,})\b/g, (whole, initial, rest) => (
      isKnownWord(initial + rest, words) ? initial + rest : whole
    ))
}

/**
 * Every hyphenated word the document writes out in full on one line.
 *
 * A margin number printed inside a broken word is the only evidence that the
 * hyphen before it is the printer's rather than the drafter's: "sec- 2 ondary"
 * has to close up to "secondary", while "low- 5 income" must keep its hyphen.
 * Bills are repetitive enough that a genuine compound almost always appears
 * unbroken somewhere else in the same document, which makes the document its
 * own dictionary and keeps the decision off a hardcoded word list.
 */
function collectCompounds(source) {
  const compounds = new Set()
  for (const match of source.matchAll(/\b([A-Za-z]{2,}|\d{1,4})-([A-Za-z]{2,})\b/g)) {
    compounds.add(`${match[1].toLowerCase()}-${match[2].toLowerCase()}`)
  }
  return compounds
}

/** Every word the document writes whole, for the same reason as above. */
function collectWords(source) {
  const words = new Set()
  for (const match of source.matchAll(/[A-Za-z]{3,}/g)) words.add(match[0].toLowerCase())
  return words
}

/**
 * Whether the document uses this word. A heading sets a term in small caps
 * where the prose inflects it — "R EPORT DATA" against "reporting" — so a few
 * endings are tried before giving up, which is enough to tell a broken word
 * from a subpart letter that only looks like one ("PART D OF IDEA" → "dof").
 */
function isKnownWord(candidate, words) {
  const word = candidate.toLowerCase()
  if (words.has(word)) return true
  if (word.endsWith('s') && words.has(word.slice(0, -1))) return true
  return ['s', 'd', 'ed', 'es', 'ing', 'ion', 'ions'].some(suffix => words.has(word + suffix))
}

/**
 * Take the margin line numbers off a GPO PDF, a printed page at a time.
 *
 * The numbers come in two forms and both have to be counted together: a bare
 * number between two words ("programs; 24 (iii) provide"), and one swallowed by
 * a word that wrapped across the line ("institu-22 tional", "sec- 2 ondary").
 * Counting only the bare ones leaves a run too broken to recognise, which used
 * to leave a scatter of stray numbers behind on PDF-sourced bills.
 *
 * A page numbers its lines 1..~25, so the run is long and strictly ascending.
 * Whether the document is numbered at all is decided across every page at once:
 * once several pages have shown a full run, a short page — the first, with only
 * a few lines under the masthead, or the last — is trusted on a couple of
 * numbers rather than left alone for want of its own evidence.
 */
function stripGpoMarginNumbers(text, compounds) {
  const pages = text.split('<GPO_PAGE_BREAK>').map(page => findMarginRun(page, compounds))
  // One page counting most of its lines is enough to settle that the printer
  // numbered this document; the rest of the pages are then trusted on much
  // less, including the single number a page-final fragment carries.
  const numbered = pages.filter(page => page.run.length >= 8).length >= 3
    || pages.some(page => page.run.length >= 5)
  const required = numbered ? 2 : 6
  return pages
    .map(page => (
      page.run.length >= required
        || countsFromOne(page.run)
        || (numbered && page.run[0]?.value === 1)
        ? removeRun(page)
        : page.text
    ))
    .join(' <GPO_PAGE_BREAK> ')
}

/**
 * A run that opens at 1 and steps by exactly 1 is the printer counting lines.
 * Two-page resolutions never show enough numbered lines to prove the document
 * is numbered at all, and their handful of numbers used to survive into the
 * one paragraph the resolution consists of. Prose cannot fake this: a bare
 * "1 2 3" spaced like printed lines is not a sentence, and enumerators are
 * parenthesised or followed by a period, so they are not bare numbers here.
 */
function countsFromOne(run) {
  return run.length >= 3 && run.every((hit, index) => hit.value === index + 1)
}

/** The longest ascending count of margin numbers on one printed page. */
function findMarginRun(text, compounds = new Set()) {
  // The bare form has to match at a page edge too: the last number on a page
  // sits flush against the footer that was just cut away. The wrapped form
  // keeps its space optional: the extraction sets "institu-22 tional" tight and
  // "sec- 2 ondary" loose, page by page, with no pattern to either.
  // The broken half can be a figure as well as a word: "the 5- 11 cent coin".
  const CANDIDATE = /([A-Za-z]+|\d{1,4})-\s*(\d{1,2})\s+(?=[A-Za-z])|(?<=^|\s)(\d{1,2})(?=\s|$)/g
  const tokens = text.split(' ')
  const hits = []
  for (const match of text.matchAll(CANDIDATE)) {
    const wrapped = match[2] !== undefined
    // A wrapped number is part of a broken word and can never be a citation.
    // A bare one can be, and a citation is excluded from the count entirely
    // rather than merely spared: "section 5 of the College Trans-5 parency
    // Act" holds both a citation and the real margin number, and the count
    // has to reach past the first to find the second.
    if (!wrapped && isCitedNumber(tokens, text.slice(0, match.index).split(' ').length - 1)) continue
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      value: Number(wrapped ? match[2] : match[3]),
      // A wrapped number leaves the two halves of its word to be rejoined,
      // with the hyphen only if the document uses it away from a line break.
      replacement: wrapped ? match[1] + (joinsHyphenated(match, text, compounds) ? '-' : '') : '',
    })
  }

  // Longest ascending run, allowing one number to have gone missing. Where two
  // starts tie, the later one wins: a number in the prose that happens to sit
  // above the page's first printed line only ever prepends itself to the real
  // count, and taking it would cut a word out of the bill ("119TH CONGRESS 1
  // ST SESSION" ahead of a page numbered 1, 2, 3...).
  let run = []
  for (let start = 0; start < hits.length && start + run.length <= hits.length; start++) {
    const candidate = [hits[start]]
    for (let next = start + 1; next < hits.length; next++) {
      const last = candidate[candidate.length - 1]
      const step = hits[next].value - last.value
      if (step < 1 || step > 2) continue
      // Every printed line carries words, so two numbers with nothing between
      // them are not two lines. That is the whole of what separates the count
      // from the citation in "chapter 1 2 of such Code" — they sit side by
      // side, and only one of them can be the line the printer numbered.
      if (!text.slice(last.end, hits[next].start).trim()) continue
      candidate.push(hits[next])
    }
    if (candidate.length >= run.length) run = candidate
  }
  return { text, run }
}

/**
 * Whether the word a margin number broke keeps its hyphen once rejoined.
 * "low- 5 income" does, because the bill writes "low-income" elsewhere;
 * "sec- 2 ondary" does not, because "sec-ondary" appears nowhere.
 */
function joinsHyphenated(match, text, compounds) {
  const rest = text.slice(match.index + match[0].length)
  const right = rest.match(/^[A-Za-z]+/)
  if (!right) return false
  return compounds.has(`${match[1].toLowerCase()}-${right[0].toLowerCase()}`)
}

function removeRun({ text, run }) {
  let out = ''
  let cursor = 0
  for (const hit of run) {
    out += text.slice(cursor, hit.start) + hit.replacement
    cursor = hit.end
  }
  return out + text.slice(cursor)
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

// Words that make the number after them part of the law rather than part of
// the printing, and units that do the same from the other side.
// "Act" is deliberately absent: no citation reads "Act 5 of", while a bill's
// own short title breaks across a printed line exactly there — "the ''Inspired
// to Serve Act 4 of 2025''" is the margin number sitting inside the title.
const CITES_A_NUMBER = /^(?:sections?|subsections?|subdivisions?|subparagraphs?|paragraphs?|clauses?|subclauses?|chapters?|subchapters?|titles?|parts?|subparts?|divisions?|items?|articles?|amendments?|rules?|forms?|no|nos|number|numbers|U\.?S\.?C|C\.?F\.?R|Pub|law|code|note|table|figure|column|line|page|volume|vol|§+)$/i
// Units of measure count too: a bill that sets the weight of a coin prints
// "(A) 5 grams" on the line whose margin number is also 5, and the printed
// count must not be allowed to swallow the figure the law turns on.
const NUMBER_UNITS = /^(?:percent|per|percentage|days?|weeks?|months?|years?|hours?|minutes?|dollars?|cents?|U\.?S\.?C\.?|C\.?F\.?R\.?|Stat|billion|million|thousand|times|grams?|kilograms?|pounds?|ounces?|tons?|miles?|feet|inches|acres?|gallons?|liters?)$/i

const SPELLED_NUMBER = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|[a-z]+-(?:one|two|three|four|five|six|seven|eight|nine))$/i

// Abbreviations that carry a period and still cite the number after them,
// unlike an ordinary word whose period simply ends the sentence.
const NUMBERED_ABBREVIATION = /^(?:no|nos|vol|art|sec|secs|par|ch|pt|Pub|U\.?S\.?C|C\.?F\.?R|Stat)$/i

/** Whether this bare integer is doing work in the sentence, not the margin. */
function isCitedNumber(tokens, index) {
  const before = (tokens[index - 1] || '').replace(/^[("'“‘]+/, '')
  const trimmed = before.replace(/[),.;:"'”’]+$/g, '')
  const after = (tokens[index + 1] || '').replace(/[),.;:"'”’]+$/g, '')
  // "...the College Transparency Act. 6" ends a sentence; the number after it
  // is the margin, not a citation. "section 5" and "No. 12" do cite.
  const endsSentence = /[.!?;:]$/.test(before) && !NUMBERED_ABBREVIATION.test(trimmed)
  // A citation names what it points into — "section 5 of the College
  // Transparency Act", "chapter 35 of title 44". Without that the citing word
  // is only the word this line happened to break after, and the number is the
  // margin: "described in this paragraph 3 shall not include".
  if (!endsSentence && CITES_A_NUMBER.test(trimmed) && /^of$/i.test(after)) return true
  // A unit only vouches for the number in front of it. Where the quantity is
  // spelled out the figure is already complete, and anything printed between
  // it and the unit is the margin: "one hundred forty 29 grams".
  if (SPELLED_NUMBER.test(trimmed)) return false
  return NUMBER_UNITS.test(after)
}

/**
 * Strip the margin line numbers that legislative printers set beside every
 * printed line and that text extraction drops into the prose ("exempt from
 * taxation 4 under Section 501(c)(3)").
 *
 * Removing every bare integer would destroy real statutory references, so this
 * only removes numbers that belong to a long, strictly consecutive run spaced
 * like printed lines. Statutory citations never form a 1, 2, 3, ... chain at
 * regular word intervals, which makes the run itself the evidence. A citation
 * that happens to land on the count is protected outright — see isCitedNumber.
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
  // A printed number can go missing — swallowed by page furniture, or by a
  // word that wrapped mid-hyphen. Tolerating one absent number keeps a single
  // chain intact instead of splitting it and stranding its opening few
  // numbers in the prose.
  const MAX_SKIP = 2
  const drop = new Set()

  let start = 0
  while (start < numbers.length) {
    const run = [numbers[start]]
    let cursor = start
    for (let next = start + 1; next < numbers.length; next++) {
      const candidate = numbers[next]
      const current = numbers[cursor]
      const step = candidate.value - current.value
      if (step < 1 || step > MAX_SKIP) continue
      const gap = candidate.index - current.index
      // A skipped number means roughly a line's worth of extra words.
      if (gap < MIN_GAP || gap > MAX_GAP * step) continue
      run.push(candidate)
      cursor = next
    }
    if (run.length >= MIN_RUN) {
      // A citation can sit exactly where the count expects a line number, and
      // deleting it rewrites the law: "in accordance with section 5 of the
      // College Transparency Act" must not become "in accordance with section
      // of the College Transparency Act". Such a number still counts toward
      // the run — dropping it from the chain would break the run in two — it
      // just never leaves the text.
      for (const entry of run) if (!isCitedNumber(tokens, entry.index)) drop.add(entry.index)
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

/**
 * The shape of an enumerator: a number, a single letter, roman numerals, or the
 * doubled letter of the item level. Deliberately narrower than "any short
 * parenthesis" — bills carry parenthetical annotations in exactly that
 * position, and "(NEW)" marking a new section of statute or "(ENV)" naming the
 * committee of reference are not places in the ladder.
 */
const ENUM = String.raw`\d{1,3}|[A-Za-z]|[ivxl]{2,6}|[IVXL]{2,6}|[a-z]{2,3}`
const ENUM_MARKER = new RegExp(String.raw`\((?:${ENUM})\)`, 'g')

// A provision can open on a run of markers when a level has a single child —
// "(A)(i)" cites one place, and drafters print the pair together. The optional
// bracket is a state repeal opening on the same provision.
const LEADING_MARKERS_RE = new RegExp(String.raw`^(\[?)((?:\((?:${ENUM})\)\s+){1,3})`)

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
    for (const marker of run[2].match(ENUM_MARKER)) ladder.depthFor(marker.slice(1, -1))
    return position + lead + run[0].length
  }

  const parts = []
  // A marker may be followed by prose or, where a subparagraph opens straight
  // onto its first clause, by the next marker down — "shall enroll (A) (i)".
  const candidates = new RegExp(String.raw`(\S+)\s+\((${ENUM})\)\s+(?=[A-Za-z“]|\((?:${ENUM})\)\s)`, 'g')
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
  // A GPO PDF prints the same "-- 4 of 11 --" page counter a state legislature
  // does, so the counter alone cannot decide this. Federal text taken for state
  // text gets its brackets restyled as repeals, which they are not.
  const looksStatePrinted = !isGpoPdfText(raw)
    && (/[-–—]{1,2}\s*\d+\s+of\s+\d+\s*[-–—]{1,2}/.test(raw)
      || /\bLCO\s+(?:No\.\s*)?\d+\b/i.test(raw))
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
    // The masthead opens with the GPO document class ("I", "III", "IV"), which
    // names the printing series and means nothing to a reader. Take it with the
    // break rather than leaving it stranded as a one-letter paragraph.
    // Only the masthead pairs the Congress with its session; "for the 120th
    // Congress" in the middle of a sentence must not be broken out of it.
    .replace(
      /(?:^|\s)(?:[IV]{1,4}\s+)?(?=\d+(?:st|nd|rd|th) CONGRESS\s+\d+(?:st|nd|rd|th|d) SESSION\b)/gi,
      '\n'
    )
    .replace(/\s+(?=(?:SECTION|SEC\.)\s+\d+[A-Z0-9.-]*[.\s])/g, '\n')
    // States print the same label in mixed case. Requiring both a sentence
    // boundary before it and a period straight after the number keeps ordinary
    // cross-references ("in section 12-81 of the general statutes") intact.
    .replace(/(?<=[.,:;”’")\]])\s+(?=(?:Section|Sec\.)\s+\d+[a-z]?\.)/g, '\n')
    .replace(/\s+(?=(?:TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART|DIVISION)\s+[IVXLCDM\d]+\b)/g, '\n')
    // \x60 is the backtick GPO doubles to open a quotation; writing it escaped
    // keeps the pair from closing this template literal.
    .replace(new RegExp(String.raw`\s+(?=(?:\x60\x60|“)\((?:${ENUM})\)\s+)`, 'g'), '\n')
    // A marker that follows sentence-ending punctuation, a dash, or a colon
    // opens a new provision. References inside a sentence ("subsection (k) the
    // following") are preceded by a word, so they stay put. A state repeal
    // bracket can sit between the two. The conjunction that closes a list item
    // stays with the item it closes: whether a list reads "and" or "or" decides
    // whether every condition binds or any one of them does.
    .replace(new RegExp(String.raw`(?<=[—:;.])(\s+(?:and|or))?\s+(?=\[?\((?:${ENUM})\)\s+)`, 'g'), '$1\n')
    .replace(new RegExp(String.raw`\s+(?=\[?\((?:${ENUM})\)\s+[A-Z])`, 'g'), '\n')
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
    if (new RegExp(String.raw`^“\s*\((?:${ENUM})\)`).test(line)) {
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
        const markers = provisionMatch[2].match(ENUM_MARKER)
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
