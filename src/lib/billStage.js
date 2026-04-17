// Canonical status-stage vocabulary shared by the server, DB, and UI.
// Every bill carries one of these strings. The 5-dot progress bar maps each
// stage to a 1..5 dot position; terminal stages (enacted/vetoed/failed) all
// live on dot 5 but the label at that dot differs so we don't mislabel a
// vetoed bill as "Signed".

const STAGE_TO_DOT = {
  introduced:   1,
  in_committee: 2,
  floor_vote:   3,
  passed_one:   3,
  passed_both:  4,
  enacted:      5,
  vetoed:       5,
  failed:       5,
}

const DEFAULT_LABELS = ['Introduced', 'Committee', 'Floor Vote', 'Passed', 'Signed']

// Accept legacy numeric shapes (1..5) from pre-refactor cached bookmarks.
const NUMERIC_TO_STAGE = {
  1: 'introduced',
  2: 'in_committee',
  3: 'floor_vote',
  4: 'passed_both',
  5: 'enacted',
}

export function normalizeStage(stage) {
  if (stage == null || stage === '') return null
  if (typeof stage === 'number') return NUMERIC_TO_STAGE[stage] || null
  const s = String(stage).toLowerCase().trim()
  if (s in STAGE_TO_DOT) return s
  if (/^\d+$/.test(s)) return NUMERIC_TO_STAGE[Number(s)] || null
  if (s === 'signed') return 'enacted'
  if (s === 'enrolled') return 'passed_both'
  if (s === 'engrossed') return 'floor_vote'
  if (s === 'dead' || s === 'withdrawn' || s === 'tabled') return 'failed'
  return null
}

export function stageToDot(stage) {
  const n = normalizeStage(stage)
  return n ? STAGE_TO_DOT[n] : 0
}

// Returns the 5 labels for the dot row, with the last label swapped for
// terminal-but-not-signed outcomes.
export function stageLabels(stage) {
  const n = normalizeStage(stage)
  const labels = DEFAULT_LABELS.slice()
  if (n === 'vetoed') labels[4] = 'Vetoed'
  else if (n === 'failed') labels[4] = 'Failed'
  return labels
}

export function stagesEqual(a, b) {
  return normalizeStage(a) === normalizeStage(b)
}
