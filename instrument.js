// Sentry initialization, preloaded via `node --import ./instrument.js` so that
// Sentry's OpenTelemetry hooks wrap Express *before* api/server.js imports it.
// Required for request-level auto-instrumentation per Sentry's ESM docs:
// https://docs.sentry.io/platforms/javascript/guides/express/install/esm/
//
// Safe no-op when SENTRY_DSN is unset, so local dev and CI don't need the var.
import * as Sentry from '@sentry/node'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    // No PII: student profiles and bill text should never land in Sentry.
    // Error payloads only.
    sendDefaultPii: false,
  })
}
