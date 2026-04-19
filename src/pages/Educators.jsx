import { useNavigate } from 'react-router-dom'
import styles from './Educators.module.css'

const LESSONS = [
  {
    num: '01',
    title: 'How a Bill Becomes Law',
    desc: 'Students use the bill status tracker to find three bills at different stages: introduced, in committee, and passed. They compare the legislative journey of each and identify what must happen next for each bill to advance.',
  },
  {
    num: '02',
    title: 'Bills That Affect Your Community',
    desc: 'Students set up their profiles with their state, grade, and interests, then compare personalized results with classmates. Discussion focuses on why different profiles surface different legislation and what that reveals about civic relevance.',
  },
  {
    num: '03',
    title: 'Taking Civic Action',
    desc: 'Each student picks a bill they care about, reviews the civic actions list, and drafts a letter to their representative using the share-post feature. The class discusses what makes civic communication effective.',
  },
]

const STEPS = [
  { num: '1', title: 'Create a Classroom', desc: 'Set up your classroom from the teacher dashboard with a name and description.' },
  { num: '2', title: 'Share the Join Code', desc: 'Give students the 6-character code to join your classroom on any device.' },
  { num: '3', title: 'Assign Bills', desc: 'Pin specific bills for the class to review, or let students explore their personalized feed.' },
  { num: '4', title: 'Track Progress', desc: 'See which bills students have viewed, bookmarked, and interacted with.' },
]

export default function Educators() {
  const navigate = useNavigate()

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.hero}>
          <h1>For Educators</h1>
          <p>
            Bring real legislation into your classroom. CapitolKey gives students
            a nonpartisan, plain-language window into the laws shaping their lives,
            aligned to the standards you already teach. Built by a student who
            wanted the tool that didn't exist.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Sample Lesson Plans</h2>
          <p>
            Three ready-to-use lesson outlines that pair CapitolKey features with
            structured classroom activities. Each can be adapted for grades 9 through 12.
          </p>
          <div className={styles.lessonGrid}>
            {LESSONS.map(l => (
              <div key={l.num} className={styles.lessonCard}>
                <span className={styles.lessonNumber}>Lesson {l.num}</span>
                <h3>{l.title}</h3>
                <p>{l.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <h2>Getting Started</h2>
          <p>
            CapitolKey classrooms let you organize students, assign bills, and
            monitor engagement, all from your teacher dashboard.
          </p>
          <div className={styles.stepsGrid}>
            {STEPS.map(s => (
              <div key={s.num} className={styles.stepCard}>
                <div className={styles.stepNumber}>{s.num}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.cta}>
          <h2>Ready to bring CapitolKey to your classroom?</h2>
          <button className={styles.ctaBtn} onClick={() => navigate('/classroom')}>
            Set up a classroom →
          </button>
        </div>

        <div className={styles.legal}>
          <button onClick={() => navigate('/privacy')}>Privacy Policy</button>
          <span className={styles.legalDot}>·</span>
          <button onClick={() => navigate('/terms')}>Terms of Service</button>
          <span className={styles.legalDot}>·</span>
          <button onClick={() => navigate('/contact')}>Contact</button>
        </div>

      </div>
    </main>
  )
}
