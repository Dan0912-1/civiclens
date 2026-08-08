# Sentry auto-fix

Whenever a new error shows up in Sentry, this system automatically opens a draft
pull request that fixes the root cause. It runs in GitHub Actions (so it works
with your laptop closed) and on the Claude Max subscription (so it does not spend
extra Anthropic API credits).

## How it works

```
Sentry (new unresolved issue)
        |
   scheduled workflow  (.github/workflows/sentry-autofix.yml, hourly)
        |
   scan job            scripts/sentry-autofix.mjs scan
        |              - query Sentry for newly-seen unresolved issues
        |              - drop any that already have an autofix branch/PR (dedup)
        |              - emit up to N highest-volume issues as a JSON work-list
        |
   fix job (matrix: one per issue, serialized)
        |              - Claude reads the Sentry stack trace + context
        |              - fixes the root cause in the repo
        |              - self-verifies with `npm run verify` (the exact CI gate)
        |              - peter-evans/create-pull-request opens ONE draft PR
        |
   draft PR on GitHub  labelled `sentry-autofix`, base `main`
```

It never merges and never pushes to `main`. Every result is a **draft PR** for
you to review and merge, exactly like any other change.

**Dedup is stateless:** the open/closed PRs *are* the record of what has been
handled. The scan skips any issue whose short id already appears in an
`autofix/sentry-<shortid>` branch or a PR title `[SHORT-ID]`, so no issue is ever
fixed twice and there is no state file to maintain.

**Scope:** the default query is `is:unresolved firstSeen:-14d`, i.e. errors that
first appeared in the last 14 days. That targets *new* errors and stays out of
the way of a separate effort working through the older backlog. Override with the
`AUTOFIX_QUERY` variable if you want it to chew the whole backlog instead.

**No-safe-fix path:** if Claude decides there is no safe automated fix (ambiguous,
needs a product decision, not reproducible, or an external/config cause), it does
not invent a risky change. It writes its diagnosis to
`docs/autofix-notes/<SHORT-ID>.md` and opens a `[needs-triage]` draft PR so you
get a head start and the issue is not retried.

## One-time setup

### 1. Secrets — repo Settings → Secrets and variables → Actions → **Secrets**

| Secret | Required | What it is |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | Run `claude setup-token` locally (uses your Max subscription). Paste the token. |
| `SENTRY_AUTH_TOKEN` | yes | Sentry → Settings → Auth Tokens (or a Developer Settings → Internal Integration). Scopes: `event:read`, `project:read`. |
| `AUTOFIX_GH_TOKEN` | recommended | A PAT (fine-grained: this repo, Contents + Pull requests = Read/Write). Without it the PRs still open, but **CI will not run on them** (GitHub suppresses workflow triggers on PRs opened by the default token). |

> **`SENTRY_ORG` and `SENTRY_PROJECTS` belong in Variables, not Secrets** (see the
> next table). They were secrets originally and it silently broke the whole
> pipeline: the scan's JSON output embeds the project slug and an org-bearing
> permalink, and Actions drops any job output containing a registered secret value
> (`Skip output 'result' since it may contain secret`). `needs.scan.outputs.result`
> arrived empty, the fix job's `if` went false, and the run reported **success**
> having fixed nothing. Neither slug is sensitive; both are in every Sentry URL.

> Prefer an API key over the subscription? Swap `claude_code_oauth_token` for
> `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}` in the workflow. That bills
> Anthropic API usage per run instead of using Max.

### 2. Variables — same screen → **Variables**

| Variable | Default | Purpose |
| --- | --- | --- |
| `SENTRY_ORG` | (unset) | **Required.** Your org slug. It is in any Sentry URL: `sentry.io/organizations/<this>/...`. |
| `SENTRY_PROJECTS` | (unset) | **Required.** Comma-separated project slugs, e.g. `capitolkey-frontend,capitolkey-backend` (Project Settings → General → Name/slug). |
| `AUTOFIX_ENABLED` | (unset) | Set to `true` to turn the schedule on. Until then, scheduled runs no-op green. This is the on/off switch. |
| `AUTOFIX_MAX_PER_RUN` | `3` | Max PRs opened per run (clamped 1..10). |
| `AUTOFIX_FIRST_SEEN_WINDOW` | `14d` | How recent "new" means. |
| `AUTOFIX_QUERY` | (unset) | Full Sentry search override, e.g. `is:unresolved` for the whole backlog. |
| `SENTRY_HOST` | `https://sentry.io` | Set only for self-hosted Sentry. |

### 3. Try it

- Run it on demand: Actions → **Sentry auto-fix** → Run workflow (this works even
  before `AUTOFIX_ENABLED` is set, so you can test first).
- Locally, the scan is just: `SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECTS=... node scripts/sentry-autofix.mjs scan`
- Inspect one issue's context: `node scripts/sentry-autofix.mjs context <issueId>`

## Tuning and cost

- **Cadence:** edit the `cron` in the workflow. `'23 */3 * * *'` is every 3 hours;
  the scan is cheap, the (paid) fix jobs only run when there is something new.
- **Pause:** set `AUTOFIX_ENABLED` to anything other than `true`, or disable the
  workflow in the Actions tab.
- **Model:** `claude_args: --model` is `claude-sonnet-4-6`. Bump to
  `claude-opus-4-8` for harder bugs.
- **Actions minutes:** hourly scans on a private repo use runner minutes. If that
  matters, widen the cron interval.
