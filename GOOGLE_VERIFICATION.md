# Google OAuth Verification — submission package

Goal: remove the "Google hasn't verified this app" warning and the 100-user cap
for the Google Classroom integration. CapitolKey requests two **sensitive**
scopes (`classroom.courses.readonly`, `classroom.coursework.students`) and **no
restricted scopes**, so this is the standard sensitive-scope review — **no CASA
security assessment required**. Google's review is typically **up to ~10 days**
after a complete submission.

Project: **govdecoded** (the app's GCP project). OAuth client: **CapitolKey Web**
(`474783909219-rbtgg2gi6l5ihddt5ha3aoln5p2a3lj1.apps.googleusercontent.com`).

## Prerequisites (consent screen)
- App name: **CapitolKey** — done
- User support email + developer contact — done (dejacius@gmail.com)
- App homepage: `https://capitolkey.org` — set during Phase 4
- Privacy policy: `https://capitolkey.org/privacy` (now includes the Google
  "Limited Use" disclosure) — done
- Authorized domain: `capitolkey.org` — done
- **Domain ownership verified in Google Search Console** for `capitolkey.org`,
  under an account with Owner/Editor — **CONFIRM THIS** (most common blocker).
  Check at https://search.google.com/search-console — if `capitolkey.org` isn't a
  verified property, add it (DNS TXT record is easiest) before submitting.

## Scope justification (paste into the consent screen "How will the scopes be used?")
> CapitolKey (capitolkey.org) is a nonpartisan civic-education web app that
> explains U.S. legislation to high-school students. Teachers assign a bill to
> their class and grade completion.
>
> classroom.courses.readonly — We call courses.list (teacherId=me, ACTIVE
> courses) only to show the teacher their own class list so they can choose which
> class to post a CapitolKey assignment to. We do not read course content or
> rosters. No narrower scope returns just the teacher's course names.
>
> classroom.coursework.students — We create the assignment in the chosen class
> via courses.courseWork.create (a Link to the CapitolKey bill page), and when the
> student finishes reading we write their grade via
> courses.courseWork.studentSubmissions.patch (assignedGrade + draftGrade) and
> .return. This is the minimal scope that can both create coursework and grade the
> submissions our own app creates; the read-only Classroom scopes cannot create
> coursework or set grades.
>
> Data handling: we store only an encrypted OAuth refresh token (to post grades
> when the teacher is offline) and the course/coursework IDs we created. We do not
> store rosters, student work, or course content. Our use of Google user data
> follows the Google API Services User Data Policy, including Limited Use.

## Demo video (record unlisted on YouTube; English narration; keep the browser address bar visible the whole time)
The video MUST show the OAuth consent flow, the app name on the consent screen,
the client ID in the address bar, and each sensitive scope working.

1. (~5s) Show `https://capitolkey.org`. "This is CapitolKey, a nonpartisan civics app for high-school students."
2. (~10s) Sign in as a teacher. Open a bill, click **Assign → Assign in Google Classroom**, then **Connect Google Classroom** (or show it's already connected, then revoke + reconnect so the consent flow is on camera).
3. (~15s) On the Google consent screen, pause so it clearly shows **CapitolKey** and the requested permissions (view classes; create + grade coursework). Keep the **address bar visible so the client_id `474783909219-...` shows**. Click Allow. *(Demonstrates the consent flow + both scopes.)*
4. (~15s) **courses.readonly:** in the assign modal, show the dropdown listing your Google Classroom classes (from `courses.list`). Pick one.
5. (~15s) **coursework.students — create:** choose **Assign now**, submit. Switch to Google Classroom and show the new assignment in that class (from `courseWork.create`).
6. (~20s) **coursework.students — grade:** open the assignment link as a student (a second account), sign in, read the bill so it auto-submits for credit. Back in the Classroom teacher view, show the student's **grade now appears** (from `studentSubmissions.patch` + `.return`).
7. (~5s) Show the **Disconnect** button on the Classrooms page (revokes access).

Target length 1-2 minutes. Upload to YouTube as **Unlisted**, copy the link.

## Submit
In `console.cloud.google.com` → **Google Auth Platform → Verification Center**
(or the OAuth consent screen "Publishing status" / "Prepare for verification"):
1. Confirm the consent screen prerequisites above.
2. Paste the scope justification (already entered in Data Access during Phase 4).
3. Paste the unlisted YouTube demo link.
4. Submit for verification.

## Status
- **Done by setup:** scopes reduced to the two sensitive ones; consent screen app
  name / homepage / privacy / terms set; scope justification entered in the Data
  Access screen; this package.
- **You must:** (1) confirm `capitolkey.org` is verified in Search Console,
  (2) record + upload the demo video, (3) paste the video link and click Submit.
- The ~10-day review is Google's. While it's pending (and for any school on
  Google Workspace), a Workspace admin can mark the client ID **Trusted** to skip
  the warning for that domain immediately (Admin console → Security → API
  controls → App access control).
