// api/emailTemplates.js — Email templates for bill-update notifications

export function billUpdateEmail(userName, changedBills) {
  const billRows = changedBills.map(b => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
        <strong style="color:#111827">${b.type} ${b.number}</strong>
        <span style="color:#6b7280;font-size:13px"> &middot; ${b.congress}th Congress</span>
        <br>
        <span style="color:#374151;font-size:14px">${b.title}</span>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <span style="color:#9ca3af;font-size:13px;text-decoration:line-through">${b.oldAction}</span>
        <br>
        <span style="color:#059669;font-size:14px;font-weight:600">${b.newAction}</span>
      </td>
    </tr>`).join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

      <!-- Header -->
      <div style="background:#111827;padding:24px 24px 20px">
        <span style="font-size:20px;color:#fff;font-weight:700">&#9878; GovDecoded</span>
        <p style="color:#9ca3af;margin:6px 0 0;font-size:14px">Bill Status Update</p>
      </div>

      <!-- Body -->
      <div style="padding:24px">
        <p style="color:#374151;font-size:15px;margin:0 0 16px">
          Hi${userName ? ` ${userName}` : ''},
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
          <a href="https://civiclens-six.vercel.app/bookmarks" style="color:#2563eb;text-decoration:none;font-weight:600">View your saved bills &rarr;</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
        <p style="color:#9ca3af;font-size:12px;margin:0">
          You're receiving this because you have email notifications enabled on GovDecoded.
          To stop these emails, turn off notifications in your <a href="https://civiclens-six.vercel.app/bookmarks" style="color:#9ca3af">Saved Bills</a> page.
        </p>
      </div>

    </div>
  </div>
</body>
</html>`

  const subject = changedBills.length === 1
    ? `${changedBills[0].type} ${changedBills[0].number} has a new status update`
    : `${changedBills.length} of your saved bills have new status updates`

  return { subject, html }
}
