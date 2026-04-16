// api/emailTemplates.js — Email templates for bill-update notifications

// Escape user / upstream content before interpolation into email HTML.
// userName comes from OAuth metadata (Google display name — attacker
// controlled) and bill fields come from LegiScan (lower trust but still
// uncontrolled). Without escaping, an attacker could inject phishing links
// or tracking pixels into a "from CapitolKey" email.
function escapeHtml(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function billUpdateEmail(userName, changedBills, frontendUrl = 'https://capitolkey.vercel.app') {
  const safeName = escapeHtml(userName)
  const billRows = changedBills.map(b => {
    const milestoneBadge = b.milestone
      ? `<span style="display:inline-block;background:#111827;color:#fff;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:2px 8px;border-radius:2px;margin-left:8px">${escapeHtml(b.milestone)}</span>`
      : ''
    return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
        <strong style="color:#111827">${escapeHtml(b.type)} ${escapeHtml(b.number)}</strong>
        <span style="color:#6b7280;font-size:13px"> &middot; ${escapeHtml(b.congress)}th Congress</span>
        <br>
        <span style="color:#374151;font-size:14px">${escapeHtml(b.title)}</span>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <span style="color:#9ca3af;font-size:13px;text-decoration:line-through">${escapeHtml(b.oldAction)}</span>
        <br>
        <span style="color:#059669;font-size:14px;font-weight:600">${escapeHtml(b.newAction)}</span>${milestoneBadge}
      </td>
    </tr>`
  }).join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

      <!-- Header -->
      <div style="background:#111827;padding:24px 24px 20px">
        <span style="font-size:20px;color:#fff;font-weight:700">&#9878; CapitolKey</span>
        <p style="color:#9ca3af;margin:6px 0 0;font-size:14px">Bill Status Update</p>
      </div>

      <!-- Body -->
      <div style="padding:24px">
        <p style="color:#374151;font-size:15px;margin:0 0 16px">
          Hi${safeName ? ` ${safeName}` : ''},
        </p>
        <p style="color:#374151;font-size:15px;margin:0 0 20px">
          ${changedBills.length === 1 ? 'A bill you saved' : `${changedBills.length} bills you saved`} had a status change on Congress.gov:
        </p>

        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:10px 16px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Bill</th>
              <th style="padding:10px 16px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Status Change</th>
            </tr>
          </thead>
          <tbody>
            ${billRows}
          </tbody>
        </table>

        <p style="color:#374151;font-size:15px;margin:20px 0 0">
          <a href="${frontendUrl}/bookmarks" style="color:#2563eb;text-decoration:none;font-weight:600">View your saved bills &rarr;</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
        <p style="color:#9ca3af;font-size:12px;margin:0">
          You're receiving this because you have email notifications enabled on CapitolKey.
          To stop these emails, turn off notifications in your <a href="${frontendUrl}/bookmarks" style="color:#9ca3af">Saved Bills</a> page.
        </p>
      </div>

    </div>
  </div>
</body>
</html>`

  // Subject is plain text, but newlines must be stripped for header safety.
  // Bill type/number are short and from LegiScan; still strip CR/LF defensively.
  const stripCtl = s => String(s == null ? '' : s).replace(/[\r\n]/g, ' ')
  const first = changedBills[0]
  const subject = changedBills.length === 1
    ? (first.milestone
      ? `${stripCtl(first.type)} ${stripCtl(first.number)} advanced to ${stripCtl(first.milestone)}`
      : `${stripCtl(first.type)} ${stripCtl(first.number)} has a new status update`)
    : `${changedBills.length} of your saved bills have new status updates`

  return { subject, html }
}

// Shared shell so teacher emails look like the bill-update email and don't
// drift into a second visual identity. Header + footer match; only the body
// varies per template.
function teacherEmailShell({ heading, bodyHtml, frontendUrl }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

      <div style="background:#0d1b2a;padding:24px 24px 20px">
        <span style="font-size:20px;color:#fff;font-weight:700">&#9878; CapitolKey</span>
        <p style="color:#e8a020;margin:6px 0 0;font-size:14px;letter-spacing:0.04em">${escapeHtml(heading)}</p>
      </div>

      <div style="padding:24px">
        ${bodyHtml}
      </div>

      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
        <p style="color:#9ca3af;font-size:12px;margin:0">
          You're receiving this because you created a classroom on CapitolKey.
          Manage email preferences in your <a href="${frontendUrl}/settings" style="color:#9ca3af">Settings</a>.
        </p>
      </div>

    </div>
  </div>
</body>
</html>`
}

// Fires the first time a teacher creates a classroom. One email per teacher,
// ever. The join code is the call to action; everything else is optional
// reading. Copy deliberately short: teachers skim and bounce.
export function teacherWelcomeEmail(userName, classroomName, joinCode, frontendUrl = 'https://capitolkey.org') {
  const safeName = escapeHtml(userName)
  const safeRoom = escapeHtml(classroomName)
  const safeCode = escapeHtml(joinCode)
  const firstName = safeName.split(' ')[0] || ''

  const bodyHtml = `
    <p style="color:#374151;font-size:15px;margin:0 0 16px">
      Welcome to CapitolKey${firstName ? `, ${firstName}` : ''}.
    </p>
    <p style="color:#374151;font-size:15px;margin:0 0 20px">
      Your classroom <strong style="color:#0d1b2a">${safeRoom}</strong> is ready. Students join with this code:
    </p>

    <div style="background:#f8f4ed;border:1px solid #e8a020;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px">
      <div style="color:#6b7280;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">Classroom join code</div>
      <div style="font-family:ui-monospace,'SF Mono',Monaco,monospace;font-size:32px;font-weight:700;color:#0d1b2a;letter-spacing:0.2em">${safeCode}</div>
    </div>

    <p style="color:#374151;font-size:15px;font-weight:600;margin:0 0 8px">What to do next:</p>
    <ol style="color:#374151;font-size:15px;margin:0 0 24px;padding-left:20px;line-height:1.6">
      <li style="margin-bottom:6px">Share the join code with your students. They can use it on any device.</li>
      <li style="margin-bottom:6px">Pick a bill from Search or the topic pages and click "Assign to Class."</li>
      <li>Check back in a day to see who completed it.</li>
    </ol>

    <p style="margin:0 0 8px">
      <a href="${frontendUrl}/classroom" style="display:inline-block;background:#0d1b2a;color:#fff;font-weight:600;font-size:14px;padding:12px 20px;border-radius:6px;text-decoration:none">Open your classroom &rarr;</a>
    </p>
    <p style="color:#6b7280;font-size:13px;margin:16px 0 0">
      Quick note on what students see: personalized summaries of real bills, in plain language, with "if it passes" and "if it fails" scenarios. Nonpartisan by design. You see completion counts, not individual student profiles.
    </p>
  `

  const html = teacherEmailShell({ heading: 'Your classroom is ready', bodyHtml, frontendUrl })
  const subject = `Welcome to CapitolKey${firstName ? `, ${firstName}` : ''}`
  return { subject, html }
}

// Fires once per classroom, the first time any student completes an
// assignment. Goal: reinforce the habit loop so the teacher comes back to
// see results, then assigns the next bill.
export function firstCompletionEmail(userName, classroomName, billTitle, studentCount, frontendUrl = 'https://capitolkey.org') {
  const safeName = escapeHtml(userName)
  const safeRoom = escapeHtml(classroomName)
  const safeBill = escapeHtml(billTitle)
  const firstName = safeName.split(' ')[0] || ''
  const safeCount = Number.isFinite(studentCount) && studentCount > 0 ? String(studentCount) : '1'

  const bodyHtml = `
    <p style="color:#374151;font-size:15px;margin:0 0 16px">
      Hi${firstName ? ` ${firstName}` : ''},
    </p>
    <p style="color:#374151;font-size:15px;margin:0 0 20px">
      Your first student just completed an assignment in <strong style="color:#0d1b2a">${safeRoom}</strong>.
    </p>

    <div style="background:#f8f4ed;border-left:3px solid #e8a020;padding:16px 20px;margin:0 0 24px">
      <div style="color:#6b7280;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Bill</div>
      <div style="color:#0d1b2a;font-size:15px;font-weight:600">${safeBill}</div>
      <div style="color:#6b7280;font-size:13px;margin-top:10px">${safeCount} student${safeCount === '1' ? '' : 's'} in this classroom.</div>
    </div>

    <p style="color:#374151;font-size:15px;margin:0 0 24px">
      In your dashboard you'll find aggregate completion counts and average time spent. Individual student profiles and personalized summaries stay private to the student.
    </p>

    <p style="margin:0 0 8px">
      <a href="${frontendUrl}/classroom" style="display:inline-block;background:#0d1b2a;color:#fff;font-weight:600;font-size:14px;padding:12px 20px;border-radius:6px;text-decoration:none">View your dashboard &rarr;</a>
    </p>

    <p style="color:#6b7280;font-size:13px;margin:24px 0 0">
      Ready for the next bill? Search or browse topics, then click "Assign to Class" on any bill.
    </p>
  `

  const html = teacherEmailShell({ heading: 'First student completed', bodyHtml, frontendUrl })
  const subject = `First completion in ${classroomName.replace(/[\r\n]/g, ' ')}`
  return { subject, html }
}

// Optional nudge: fires 7 days after classroom creation if the teacher has
// not yet assigned a bill. Keeps activation from stalling. Do not send if
// they already have an assignment or if they've opted out.
export function teacherFirstBillNudge(userName, classroomName, frontendUrl = 'https://capitolkey.org') {
  const safeName = escapeHtml(userName)
  const safeRoom = escapeHtml(classroomName)
  const firstName = safeName.split(' ')[0] || ''

  const bodyHtml = `
    <p style="color:#374151;font-size:15px;margin:0 0 16px">
      Hi${firstName ? ` ${firstName}` : ''},
    </p>
    <p style="color:#374151;font-size:15px;margin:0 0 20px">
      You set up <strong style="color:#0d1b2a">${safeRoom}</strong> a week ago but haven't assigned a bill yet. A good first bill is usually one tied to something students already see in the news, or something local to your state.
    </p>

    <p style="color:#374151;font-size:15px;font-weight:600;margin:0 0 8px">Three ways to pick one:</p>
    <ul style="color:#374151;font-size:15px;margin:0 0 24px;padding-left:20px;line-height:1.6">
      <li style="margin-bottom:6px"><strong>By topic.</strong> Education, healthcare, housing, and environment pages show the most-active bills this month.</li>
      <li style="margin-bottom:6px"><strong>By state.</strong> If your state has an active legislature, filter to state bills for local relevance.</li>
      <li><strong>By keyword.</strong> Search "student loans," "AI," "climate," whatever's on students' minds.</li>
    </ul>

    <p style="margin:0 0 8px">
      <a href="${frontendUrl}/results" style="display:inline-block;background:#0d1b2a;color:#fff;font-weight:600;font-size:14px;padding:12px 20px;border-radius:6px;text-decoration:none">Browse bills &rarr;</a>
    </p>

    <p style="color:#6b7280;font-size:13px;margin:24px 0 0">
      Not a fit for your class? No hard feelings. Reply to this email and tell us what's missing. We read every note.
    </p>
  `

  const html = teacherEmailShell({ heading: 'Ready to assign your first bill?', bodyHtml, frontendUrl })
  const subject = `Ready to try a first bill with ${classroomName.replace(/[\r\n]/g, ' ')}?`
  return { subject, html }
}
