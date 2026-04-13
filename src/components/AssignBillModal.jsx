import { useState, useMemo, useRef } from 'react'
import { getSessionSafe } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import { createAssignment } from '../lib/classroom'
import styles from './AssignBillModal.module.css'

const API = getApiBase()

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
]

const TOPIC_CHIPS = [
  'Education', 'Healthcare', 'Climate', 'Immigration', 'Gun Policy', 'Student Loans',
  'Technology', 'Economy', 'Civil Rights',
]

function makeBillId(bill) {
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  return `${bill.type || bill.bill_type}${bill.number || bill.bill_number}-${bill.congress}`
}

export default function AssignBillModal({ classroomId, onClose, onAssigned }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [instructions, setInstructions] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  // Filters
  const [tab, setTab] = useState('federal')
  const [selectedState, setSelectedState] = useState('')
  const [chamberFilter, setChamberFilter] = useState('All')

  const searchInputRef = useRef(null)

  async function doSearch(q, jurisdiction, stateCode) {
    const trimmed = (q || query).trim()
    if (!trimmed) return
    setSearching(true)
    setError('')
    setHasSearched(true)
    try {
      const stateParam = jurisdiction === 'state' ? (stateCode || selectedState || 'US') : 'US'
      const resp = await fetch(`${API}/api/search?q=${encodeURIComponent(trimmed)}&state=${stateParam}`)
      if (!resp.ok) throw new Error('Search failed')
      const data = await resp.json()
      setResults(data.results || data.bills || [])
    } catch (err) {
      setError(err.message)
    }
    setSearching(false)
  }

  function handleSearch(e) {
    e.preventDefault()
    doSearch(query, tab, selectedState)
  }

  function handleTabSwitch(newTab) {
    setTab(newTab)
    setChamberFilter('All')
    if (query.trim()) doSearch(query, newTab, selectedState)
  }

  function handleStateChange(code) {
    setSelectedState(code)
    setChamberFilter('All')
    if (query.trim()) doSearch(query, 'state', code)
  }

  function handleChipClick(topic) {
    setQuery(topic)
    doSearch(topic, tab, selectedState)
    searchInputRef.current?.focus()
  }

  // Client-side chamber filter
  const filteredResults = useMemo(() => {
    if (chamberFilter === 'All') return results
    return results.filter(b => b.originChamber === chamberFilter)
  }, [results, chamberFilter])

  async function handleAssign() {
    if (!selected) return
    setAssigning(true)
    setError('')
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in'); setAssigning(false); return }

      const billId = makeBillId(selected)
      const billData = {
        title: selected.title,
        type: selected.type || selected.bill_type,
        number: selected.number || selected.bill_number,
        congress: selected.congress,
        topics: selected.topics,
        latestAction: selected.latestAction || selected.latest_action,
        jurisdiction: selected.state === 'US' ? 'Federal' : (selected.state || selected.jurisdiction),
        legiscan_bill_id: selected.legiscan_bill_id,
      }

      await createAssignment(token, classroomId, {
        billId,
        billData,
        instructions: instructions.trim() || undefined,
        dueDate: dueDate || undefined,
      })
      onAssigned()
    } catch (err) {
      setError(err.message || 'Failed to assign bill')
    }
    setAssigning(false)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2>Assign a Bill</h2>

        {!selected ? (
          <>
            {/* Search bar */}
            <form className={styles.searchRow} onSubmit={handleSearch}>
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by keyword, topic, or bill number..."
                className={styles.searchInput}
                autoFocus
              />
              <button type="submit" className={styles.searchBtn} disabled={searching}>
                {searching ? '...' : 'Search'}
              </button>
            </form>

            {/* Filter controls */}
            <div className={styles.filterSection}>
              <div className={styles.filterRow}>
                <div className={styles.tabGroup}>
                  <button
                    className={`${styles.tab} ${tab === 'federal' ? styles.tabActive : ''}`}
                    onClick={() => handleTabSwitch('federal')}
                    type="button"
                  >
                    Federal
                  </button>
                  <button
                    className={`${styles.tab} ${tab === 'state' ? styles.tabActive : ''}`}
                    onClick={() => handleTabSwitch('state')}
                    type="button"
                  >
                    State
                  </button>
                </div>

                {tab === 'state' && (
                  <select
                    className={styles.stateSelect}
                    value={selectedState}
                    onChange={e => handleStateChange(e.target.value)}
                  >
                    <option value="">Select state</option>
                    {US_STATES.map(s => (
                      <option key={s.code} value={s.code}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className={styles.chamberRow}>
                {['All', 'House', 'Senate'].map(chamber => (
                  <button
                    key={chamber}
                    className={`${styles.chamberPill} ${chamberFilter === chamber ? styles.chamberActive : ''}`}
                    onClick={() => setChamberFilter(chamber)}
                    type="button"
                  >
                    {chamber}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic chips — show before first search */}
            {!hasSearched && (
              <div className={styles.chipSection}>
                <span className={styles.chipLabel}>Quick topics</span>
                <div className={styles.chipRow}>
                  {TOPIC_CHIPS.map(topic => (
                    <button
                      key={topic}
                      className={styles.chip}
                      onClick={() => handleChipClick(topic)}
                      type="button"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            {filteredResults.length > 0 && (
              <div className={styles.resultsList}>
                {filteredResults.slice(0, 15).map((bill, i) => {
                  const id = makeBillId(bill)
                  const jurisdiction = bill.state && bill.state !== 'US' ? bill.state : 'Federal'
                  const chamber = bill.originChamber || ''
                  return (
                    <button
                      key={id + i}
                      className={styles.resultItem}
                      onClick={() => setSelected(bill)}
                    >
                      <div className={styles.resultHeader}>
                        <span className={styles.resultBillNum}>
                          {bill.type || bill.bill_type} {bill.number || bill.bill_number}
                        </span>
                        <span className={styles.resultMeta}>
                          <span className={styles.badge}>{jurisdiction}</span>
                          {chamber && <span className={styles.badgeChamber}>{chamber}</span>}
                        </span>
                      </div>
                      <span className={styles.resultTitle}>
                        {(bill.title || '').slice(0, 120)}
                        {(bill.title || '').length > 120 ? '...' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Chamber filter produced no matches */}
            {hasSearched && !searching && results.length > 0 && filteredResults.length === 0 && (
              <p className={styles.noResults}>No {chamberFilter} bills found. Try "All" chambers.</p>
            )}

            {/* No results at all */}
            {hasSearched && !searching && results.length === 0 && (
              <p className={styles.noResults}>No bills found. Try a different search.</p>
            )}
          </>
        ) : (
          <div className={styles.assignForm}>
            <div className={styles.selectedBill}>
              <div className={styles.resultHeader}>
                <span className={styles.resultBillNum}>
                  {selected.type || selected.bill_type} {selected.number || selected.bill_number}
                </span>
                <span className={styles.resultMeta}>
                  <span className={styles.badge}>
                    {selected.state && selected.state !== 'US' ? selected.state : 'Federal'}
                  </span>
                </span>
              </div>
              <span className={styles.resultTitle}>{selected.title}</span>
              <button className={styles.changeBtn} onClick={() => setSelected(null)}>Change</button>
            </div>

            <label className={styles.label}>
              Instructions (optional)
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="e.g. Read the summary and be prepared to discuss in class"
                className={styles.textarea}
                maxLength={500}
                rows={3}
              />
            </label>

            <label className={styles.label}>
              Due date (optional)
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className={styles.dateInput}
              />
            </label>

            <div className={styles.actions}>
              <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
              <button
                className={styles.btnAssign}
                onClick={handleAssign}
                disabled={assigning}
              >
                {assigning ? 'Assigning...' : 'Assign to Class'}
              </button>
            </div>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
