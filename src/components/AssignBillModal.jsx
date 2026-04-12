import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import { createAssignment } from '../lib/classroom'
import styles from './AssignBillModal.module.css'

const API = getApiBase()

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

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError('')
    try {
      const resp = await fetch(`${API}/api/search?q=${encodeURIComponent(query.trim())}`)
      if (!resp.ok) throw new Error('Search failed')
      const data = await resp.json()
      setResults(data.results || data.bills || [])
    } catch (err) {
      setError(err.message)
    }
    setSearching(false)
  }

  async function handleAssign() {
    if (!selected) return
    setAssigning(true)
    setError('')
    try {
      const session = await supabase?.auth.getSession()
      const token = session?.data?.session?.access_token
      if (!token) { setError('Please sign in'); setAssigning(false); return }

      const billId = makeBillId(selected)
      const billData = {
        title: selected.title,
        type: selected.type || selected.bill_type,
        number: selected.number || selected.bill_number,
        congress: selected.congress,
        topics: selected.topics,
        latestAction: selected.latestAction || selected.latest_action,
        jurisdiction: selected.jurisdiction,
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
            <form className={styles.searchRow} onSubmit={handleSearch}>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search for a bill..."
                className={styles.searchInput}
                autoFocus
              />
              <button type="submit" className={styles.searchBtn} disabled={searching}>
                {searching ? '...' : 'Search'}
              </button>
            </form>

            {results.length > 0 && (
              <div className={styles.resultsList}>
                {results.slice(0, 10).map((bill, i) => {
                  const id = makeBillId(bill)
                  return (
                    <button
                      key={id + i}
                      className={styles.resultItem}
                      onClick={() => setSelected(bill)}
                    >
                      <span className={styles.resultBillNum}>
                        {bill.type || bill.bill_type} {bill.number || bill.bill_number}
                      </span>
                      <span className={styles.resultTitle}>
                        {(bill.title || '').slice(0, 120)}
                        {(bill.title || '').length > 120 ? '...' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {results.length === 0 && query && !searching && (
              <p className={styles.noResults}>No bills found. Try a different search.</p>
            )}
          </>
        ) : (
          <div className={styles.assignForm}>
            <div className={styles.selectedBill}>
              <span className={styles.resultBillNum}>
                {selected.type || selected.bill_type} {selected.number || selected.bill_number}
              </span>
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
