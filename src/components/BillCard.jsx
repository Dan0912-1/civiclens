import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './BillCard.module.css'

const TAG_COLORS = {
  Education:    'blue',
  Healthcare:   'green',
  Economy:      'purple',
  Environment:  'teal',
  Technology:   'red',
  Housing:      'orange',
  'Civil Rights':'violet',
  Other:        'gray',
}

function RelevanceMeter({ score }) {
  const pct = Math.round((score / 10) * 100)
  const color = score >= 7 ? '#16a34a' : score >= 4 ? '#e8a020' : '#9ca3af'
  return (
    <div className={styles.relevance}>
      <div className={styles.relevanceBar}>
        <div
          className={styles.relevanceFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className={styles.relevanceLabel} style={{ color }}>
        {score >= 7 ? 'Highly relevant' : score >= 4 ? 'Somewhat relevant' : 'Low relevance'}
      </span>
    </div>
  )
}

export default function BillCard({ bill, analysis, style, isBookmarked = false, onToggleBookmark }) {
  const [expanded, setExpanded] = useState(false)
  const { user } = useAuth()
  const billId = `${bill.type}${bill.number}-${bill.congress}`
  const tagColor = TAG_COLORS[analysis?.topic_tag] || 'gray'
  const isLoading = !analysis

  return (
    <div className={`${styles.card} ${styles[`tag_${tagColor}`]}`} style={style}>

      {/* Top accent line via tag color */}
      <div className={styles.accentLine} />

      {/* Header */}
      <div className={styles.cardHeader}>
        <div className={styles.headerLeft}>
          <span className={`${styles.tag} ${styles[`tag_${tagColor}`]}`}>
            {isLoading ? '···' : (analysis?.topic_tag || 'Other')}
          </span>
          <span className={styles.billNum}>
            {bill.type} {bill.number} · {bill.congress}th Congress
          </span>
        </div>
        <span className={styles.chamber}>{bill.originChamber || 'Congress'}</span>
      </div>

      {/* Title */}
      <h3 className={styles.title}>{bill.title}</h3>

      {/* Latest action */}
      <p className={styles.action}>
        <span className={styles.actionLabel}>Last action:</span>{' '}
        {bill.latestAction}
        {bill.latestActionDate && (
          <span className={styles.actionDate}> · {bill.latestActionDate}</span>
        )}
      </p>

      {/* Analysis — loading */}
      {isLoading && (
        <div className={styles.analyzing}>
          <div className={styles.analyzeSpinner} />
          <span>Personalizing for you...</span>
        </div>
      )}

      {/* Analysis — loaded */}
      {analysis && (
        <>
          <div className={styles.headline}>
            {analysis.headline}
          </div>

          <RelevanceMeter score={analysis.relevance} />

          <p className={styles.summary}>{analysis.summary}</p>

          {/* Expandable detail */}
          {expanded && (
            <div className={styles.detail}>
              <div className={styles.scenario}>
                <div className={styles.scenarioLabel}>✅ If it passes</div>
                <p>{analysis.if_it_passes}</p>
              </div>
              <div className={styles.scenario}>
                <div className={styles.scenarioLabel}>⏸ If it fails</div>
                <p>{analysis.if_it_fails}</p>
              </div>

              {analysis.civic_actions?.length > 0 && (
                <div className={styles.actions}>
                  <div className={styles.actionsHeading}>Take action</div>
                  {analysis.civic_actions.map((a, i) => (
                    <div key={i} className={styles.actionItem}>
                      <div className={styles.actionTitle}>{a.action}</div>
                      <p className={styles.actionHow}>{a.how}</p>
                      <span className={styles.actionTime}>⏱ {a.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.cardFooter}>
            {user && onToggleBookmark && (
              <button
                className={`${styles.bookmarkBtn} ${isBookmarked ? styles.bookmarkActive : ''}`}
                onClick={e => { e.stopPropagation(); onToggleBookmark() }}
                aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this bill'}
              >
                {isBookmarked ? '\u2605' : '\u2606'}
              </button>
            )}
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? 'Show less \u2191' : 'See full impact + actions \u2193'}
            </button>
            {bill.url && (
              <a
                href={bill.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.sourceLink}
              >
                Full bill →
              </a>
            )}
          </div>
        </>
      )}

    </div>
  )
}
