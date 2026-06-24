# Google OAuth — scopes & verification status

**TL;DR: No verification is required, and users see no "unverified app" warning.**

The Google Classroom integration requests only **non-sensitive** scopes, so Google
does not require OAuth app verification. Google's own console confirms this:

> Verification Center → Data access status:
> *"Verification is not required since your app is not requesting any sensitive or
> restricted scopes."*

## Scopes requested (project: govdecoded, client "CapitolKey Web")
| Scope | Classification | Why |
| --- | --- | --- |
| `openid` | non-sensitive | Sign-in / id token |
| `…/auth/userinfo.email` | non-sensitive | Record the connected Google account |
| `…/auth/classroom.courses.readonly` | **non-sensitive** | List the teacher's classes for the assign picker |
| `…/auth/classroom.coursework.students` | **non-sensitive** | Create coursework + write grades back |

No sensitive scopes. No restricted scopes (those would need an annual CASA
security assessment — we have none).

### How we avoided the warning
We originally also requested `classroom.profile.emails`, which **is** sensitive
and triggered the "Google hasn't verified this app" warning + a 100-user cap.
Grade passback never actually needed it: `studentSubmissions.list` accepts the
student's verified Google email directly as the `userId` filter, so matching works
with `coursework.students` alone. Removing `profile.emails` (from the code's
`GOOGLE_SCOPES` and from the consent screen's Data Access) left only non-sensitive
scopes, which removed the warning and the verification requirement entirely.

## What this means for users
- No "unverified app" / "Go to CapitolKey (unsafe)" screen.
- No 100-user lifetime cap.
- New teachers connect with a normal Google consent screen.

## Optional polish (not required, no warning either way)
- **Branding verification:** the consent screen has no logo, so the Verification
  Center shows "your branding is not being shown to users." Uploading a square
  logo and verifying branding gives a more polished consent screen. This is
  cosmetic; it does not cause any warning.

## If a sensitive/restricted scope is ever added later
If a future feature needs a sensitive scope (e.g. `classroom.rosters.readonly`
to sync a roster), verification would then be required. That path:
1. Consent screen complete (app name, homepage, privacy policy, authorized domain
   — all already set) and `capitolkey.org` verified in Google Search Console.
2. Per-scope justification in Data Access.
3. An unlisted YouTube demo video showing the OAuth consent flow (app name +
   client ID visible) and each sensitive scope in use.
4. Submit in the Verification Center; review is typically up to ~10 days; no CASA
   unless a *restricted* scope is involved.
