import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { getApiBase } from '../lib/api'
import styles from './SharePostModal.module.css'

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', maxLen: 220 },
  { id: 'x',         label: 'X',         maxLen: 270 },
  { id: 'threads',   label: 'Threads',   maxLen: 480 },
  { id: 'tiktok',    label: 'TikTok',    maxLen: 300 },
]

function haptic(style = 'Light') {
  import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle[style] }))
    .catch(() => {})
}

export default function SharePostModal({ isOpen, onClose, bill, analysis }) {
  const [platform, setPlatform] = useState('instagram')
  const [perspective, setPerspective] = useState('')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedIdx, setCopiedIdx] = useState(null)

  // Reset state whenever the modal closes so the next open is clean
  useEffect(() => {
    if (!isOpen) {
      setDrafts([])
      setError('')
      setPerspective('')
      setCopiedIdx(null)
      setPlatform('instagram')
    }
  }, [isOpen])

  if (!isOpen) return null

  async function generate() {
    setLoading(true)
    setError('')
    setDrafts([])
    setCopiedIdx(null)
    try {
      // Pull profile from sessionStorage — same source the rest of the app uses
      let profile = {}
      try {
        const stored = sessionStorage.getItem('civicProfile')
        if (stored) profile = JSON.parse(stored)
      } catch {}

      const resp = await fetch(`${getApiBase()}/api/share-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill, analysis, profile, platform, perspective }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Failed to generate drafts')
      setDrafts(data.drafts || [])
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function copyDraft(text, idx) {
    haptic('Light')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  function shareDraft(text) {
    haptic('Light')
    if (navigator.share) {
      navigator.share({ text }).catch(() => {})
    } else {
      copyDraft(text, -1)
    }
  }

  const platformSpec = PLATFORMS.find(p => p.id === platform) || PLATFORMS[0]

  // Render via portal so a `transform` on any ancestor (e.g. BillCard's
  // staggered-entry animation) doesn't break position:fixed on the overlay.
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>

        <h2 className={styles.heading}>Share your take</h2>
        <p className={styles.sub}>
          Generate 3 short drafts you can post about this bill. Edit before sharing.
        </p>

        <div className={styles.section}>
          <label className={styles.label}>Platform</label>
          <div className={styles.platformRow}>
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                className={`${styles.platformBtn} ${platform === p.id ? styles.platformBtnActive : ''}`}
                onClick={() => { setPlatform(p.id); setDrafts([]) }}
                type="button"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label} htmlFor="perspective">
            Your take <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            id="perspective"
            className={styles.textarea}
            placeholder="What do you think about this bill? One line is enough — we'll work it into the drafts."
            value={perspective}
            onChange={e => setPerspective(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
          />
          <div className={styles.charCount}>{perspective.length}/500</div>
        </div>

        <button
          className={styles.generateBtn}
          onClick={generate}
          disabled={loading}
          type="button"
        >
          {loading ? 'Writing your drafts…' : drafts.length ? 'Regenerate' : 'Write my drafts'}
        </button>

        {error && <div className={styles.error}>{error}</div>}

        {drafts.length > 0 && (
          <div className={styles.drafts}>
            {drafts.map((d, i) => (
              <div key={i} className={styles.draft}>
                <div className={styles.draftHeader}>
                  <span className={styles.angle}>{d.angle}</span>
                  <span className={styles.charLen}>
                    {d.text.length}/{platformSpec.maxLen}
                  </span>
                </div>
                <p className={styles.draftText}>{d.text}</p>
                <div className={styles.draftActions}>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copyDraft(d.text, i)}
                    type="button"
                  >
                    {copiedIdx === i ? 'Copied ✓' : 'Copy'}
                  </button>
                  <button
                    className={styles.shareBtn}
                    onClick={() => shareDraft(d.text)}
                    type="button"
                  >
                    Share
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
