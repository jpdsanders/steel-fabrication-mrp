# Testing Notes

## Dev-only login bypass (`DEV_BYPASS_AUTH`)

For internal testing, the app supports a temporary auth bypass that skips the
login screen entirely and signs every request in as a designated test user.

### How it works
- When `DEV_BYPASS_AUTH=true` **and** the server is NOT running with
  `NODE_ENV=production`, the API auto-authenticates every request as the
  bypass user (default `jsanders@exclusivefab.com`, override with
  `DEV_BYPASS_USER_EMAIL`).
- The frontend detects this via `GET /auth/me` (`authBypass: true`) and
  redirects straight past the login page.
- A persistent amber banner — **⚠️ AUTH BYPASSED — TEST MODE** — is shown at
  the top of every page while the bypass is active, so a bypassed session can
  never be mistaken for a real one.

### Safety
The production check is structural: the bypass condition in
`artifacts/api-server/src/middlewares/auth.ts` (`isAuthBypassActive()`)
requires `NODE_ENV !== "production"`. Even if `DEV_BYPASS_AUTH=true` is
accidentally left set in production configuration, the bypass has no effect
there.

### Turn on (Replit dev environment)
1. Set the environment variable `DEV_BYPASS_AUTH=true` (development environment).
2. Restart the API Server workflow.

### Turn off
1. Set `DEV_BYPASS_AUTH=false` (or remove the variable).
2. Restart the API Server workflow. Normal login is required again.

### Before go-live
Confirm `DEV_BYPASS_AUTH` is **unset** (or not `true`) in the production
deployment's environment configuration. It is inert in production regardless,
but it should not ship enabled.
