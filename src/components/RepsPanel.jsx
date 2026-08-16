import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getApiBase } from '../lib/api'
import { readCachedProfile, resolveProfile } from '../lib/userProfile'
import { decidingChamber, repLookupUrl, STATE_LEGISLATOR_FINDER } from '../lib/billUrl'
import styles from './RepsPanel.module.css'

// "Contact your rep" used to open a third-party member directory for the
// student's state — the same page for a Senate bill, a House bill and a state
// bill. This panel answers the narrower, correct question: who votes on THIS
// bill, and how do you reach them.
//
// Where we can be exact we are: senators represent a whole state, so a state
// code names both of a student's senators, and a single-district state names
// their one House member. Where we can't — a House district, or any state
// legislative district, both of which need a street address to resolve — we
// show the full delegation and say so in plain language instead of guessing.
// See api/representatives.js for why no address-free lookup gets us there.

const CHAMBER_COPY = {
  senate: {
    heading: 'Your U.S. senators',
    decides: 'The U.S. Senate votes on this bill.',
  },
  house: {
    heading: 'Your U.S. representative',
    decides: 'The U.S. House votes on this bill.',
  },
  'state-upper': {
    heading: 'Your state senator',
    decides: 'Your state senate votes on this bill — not Congress.',
  },
  'state-lower': {
    heading: 'Your state representative',
    decides: 'Your state house votes on this bill — not Congress.',
  },
}

function openExternal(url) {
  if (!url) return
  import('@capacitor/core')
    .then(async ({ Capacitor }) => {
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url, presentationStyle: 'popover' })
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    })
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}

const hasState = p => Boolean(p?.state)

function cachedProfileState() {
  return (readCachedProfile()?.state || '').toUpperCase()
}

function MemberCard({ member }) {
  const seat = member.chamber === 'senate'
    ? 'U.S. Senator'
    : member.district === 0
    ? 'U.S. Representative, at-large'
    : `U.S. Representative, District ${member.district}`
  return (
    <div className={styles.member}>
      <div className={styles.memberName}>
        {member.name}
        {member.party && <span className={styles.party}>({member.party})</span>}
      </div>
      <div className={styles.memberSeat}>{seat}</div>
      <div className={styles.memberLinks}>
        {member.phone && (
          <a className={styles.memberLink} href={`tel:${member.phone.replace(/[^\d+]/g, '')}`}>
            {member.phone}
          </a>
        )}
        {(member.contactForm || member.website) && (
          <button
            type="button"
            className={styles.memberLink}
            onClick={() => openExternal(member.contactForm || member.website)}
          >
            {member.contactForm ? 'Send a message →' : 'Official site →'}
          </button>
        )}
      </div>
    </div>
  )
}

// State bills: the people worth contacting about this specific bill are the
// ones who put their name on it. We have their chamber, district and a direct
// contact link, so we show them rather than an empty panel.
function SponsorList({ sponsors }) {
  const people = (sponsors || []).filter(s => !s.isCommittee).slice(0, 8)
  if (!people.length) return null
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Lawmakers behind this bill</div>
      {people.map((s, i) => (
        <div key={`${s.name}-${i}`} className={styles.member}>
          <div className={styles.memberName}>
            {s.role ? `${s.role}. ` : ''}{s.name}
            {s.party && <span className={styles.party}>({s.party})</span>}
          </div>
          <div className={styles.memberSeat}>
            {s.isPrimary ? 'Lead sponsor' : 'Cosponsor'}
            {s.district ? ` · ${s.district}` : ''}
          </div>
          <div className={styles.memberLinks}>
            {s.phone && (
              <a className={styles.memberLink} href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>
                {s.phone}
              </a>
            )}
            {s.contactUrl && (
              <button type="button" className={styles.memberLink} onClick={() => openExternal(s.contactUrl)}>
                Contact →
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RepsPanel({ bill, sponsors = [], onClose }) {
  const chamber = decidingChamber(bill || {})
  const isStateChamber = chamber === 'state-upper' || chamber === 'state-lower'
  const { user, loading: authLoading } = useAuth()
  const [profileState, setProfileState] = useState(cachedProfileState)
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  // Whether we've finished working out which state the student is in. Starts
  // settled when this tab has the profile cached; otherwise a signed-in
  // student's state has to come back from Supabase first, and rendering the
  // "add your state" fallback before then would flash the wrong panel at
  // someone who has a state on file.
  const [stateSettled, setStateSettled] = useState(() => Boolean(cachedProfileState()))
  const [loading, setLoading] = useState(!isStateChamber && Boolean(profileState))

  useEffect(() => {
    if (isStateChamber || stateSettled || authLoading) return
    let cancelled = false
    resolveProfile(user, hasState).then(profile => {
      if (cancelled) return
      const st = (profile?.state || '').toUpperCase()
      setProfileState(st)
      setStateSettled(true)
      // Batched with the two above, so the lookup effect below never gets a
      // render where we have a state but aren't loading yet — that gap would
      // flash "we couldn't load the member list" for a frame.
      if (st) setLoading(true)
    })
    return () => { cancelled = true }
  }, [isStateChamber, stateSettled, authLoading, user])

  useEffect(() => {
    // State chambers never return a member list (see api/representatives.js),
    // and with no state on file there is nothing to look up.
    if (isStateChamber || !profileState) return
    let cancelled = false
    setLoading(true)
    fetch(`${getApiBase()}/api/representatives?state=${profileState}&chamber=${chamber}`, {
      signal: AbortSignal.timeout(10000),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(json => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chamber, profileState, isStateChamber])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Only claim to be resolving when something could still come back: a
  // signed-in student's Supabase profile, or auth itself still settling.
  // Anonymous users go straight to the "add your state" fallback as before.
  const resolvingState = !stateSettled && (authLoading || Boolean(user))
  const copy = CHAMBER_COPY[chamber] || CHAMBER_COPY.house
  const members = data?.members || []
  const finderUrl = data?.finderUrl || repLookupUrl(bill || {})
  // "Your U.S. representative" is only true when the list is one person. For a
  // multi-district state it's the delegation, and the heading has to say that.
  const heading = !isStateChamber && members.length > 1 && !data?.exact
    ? `${profileState}'s U.S. House delegation`
    : copy.heading

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Contact your lawmakers"
      >
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.heading}>{heading}</h2>
        <p className={styles.decides}>{copy.decides}</p>

        {isStateChamber ? (
          <>
            <p className={styles.note}>
              State legislative districts are smaller than a ZIP code, so there's no way
              to name your own {chamber === 'state-upper' ? 'state senator' : 'state representative'}{' '}
              without your street address — which we don't ask students for. The official
              finder takes an address on its own site and gives you the exact answer.
            </p>
            <button className={styles.finderBtn} onClick={() => openExternal(STATE_LEGISLATOR_FINDER)}>
              Find your state legislators →
            </button>
            <SponsorList sponsors={sponsors} />
          </>
        ) : resolvingState || loading ? (
          <div className={styles.loading}>Loading your {chamber === 'senate' ? 'senators' : 'delegation'}…</div>
        ) : !profileState ? (
          <>
            <p className={styles.note}>
              Add your state to your profile and we'll name the members who vote on this bill.
            </p>
            <button className={styles.finderBtn} onClick={() => openExternal(finderUrl)}>
              Look up your members of Congress →
            </button>
          </>
        ) : failed || !members.length ? (
          <>
            <p className={styles.note}>
              We couldn't load the member list just now.
            </p>
            <button className={styles.finderBtn} onClick={() => openExternal(finderUrl)}>
              Look up your members of Congress →
            </button>
          </>
        ) : (
          <>
            {data.exact ? (
              <p className={styles.note}>
                {chamber === 'senate'
                  ? 'Senators represent the whole state, so both of these are yours.'
                  : `${profileState} elects one at-large representative, so this is yours.`}
              </p>
            ) : (
              <p className={styles.note}>
                {profileState} is split into {members.length} House districts. We know your
                state but not your street address, so we can't tell which district you live
                in — these are all {members.length}. Your ZIP code will identify yours on
                house.gov.
              </p>
            )}
            <div className={styles.section}>
              {members.map(m => <MemberCard key={m.bioguideId || m.name} member={m} />)}
            </div>
            {!data.exact && (
              <button className={styles.finderBtn} onClick={() => openExternal(finderUrl)}>
                Find your exact district on house.gov →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
