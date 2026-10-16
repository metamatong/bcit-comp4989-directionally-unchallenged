# Operations and privacy

## Setup

Use Node.js 22+, `npm ci`, and `npm run dev`. The app defaults to `127.0.0.1:3000`; frontend edits can refresh through Vite HMR on the existing listener. The Node server does not restart automatically for file changes. Restart it manually after backend, environment or regenerated data changes. A duplicate launch fails clearly; do not start another instance on the same port.

Set `GEMINI_API_KEY` in private `.env`, choose a primary `GEMINI_MODEL`, and set an ordered comma-separated `GEMINI_FALLBACK_MODELS` list. Defaults use Gemini 3.5 Flash-Lite and Gemini 3.8 Flash; Google currently lists both on the free tier. An existing 3.8 primary defaults to a 3.5 Flash-Lite backup. Explicit settings are preserved. Gemini 2.5 requires existing-project access and is never an automatic backup. Verify eligibility and generation access for the specific API project before setting `AI_FREE_TIER_CONFIRMED=true`; model metadata can return HTTP 200 even when generation returns 404. `.env.example` is a keyless template. Never put secrets in frontend variables. `AI_DEFAULT_MODE` is obsolete and ignored. No mode switch or synthetic location fallback exists.

Without provider configuration, users see setup guidance. Photo submission is disabled in the client and rejected by the server. With configuration, each photo still requires consent and an explicit Analyze action.

## Media and state

The browser accepts JPEG/PNG/WebP up to 8 MB and 50 million pixels, creates a full view and four overlapping original-image crops, each with at most a 1,600-pixel long edge and 450 KB JPEG bytes, without original metadata. The server limits photo bodies to 4 MB and aggregate decoded bytes across all five views to 2.5 MB. Two API stages send the same consented image bundle transiently to Google, first for reading labels and then for source-grounded location comparison; the application saves no media to disk, caches or session logs. Google free-tier handling is disclosed under its terms.

Mobile photo capture uses the browser/device photo picker. CampusLens does not open a live camera stream or track movement. Physical-device capture behavior remains unverified.

First-stage evidence IDs expire after five minutes and are bound to a session and image/crop fingerprint. No media is stored between API stages. A failed comparison may retry with the accepted evidence until expiry. Session results expire after 30 minutes. Reload creates a new session. Clear analysis removes the current result. No accounts, saved positions, browser location history or automatic tracking exist. Obsolete mode preferences are removed from browser storage. API responses use `no-store` and reject cross-origin requests.

## Failures and recovery

- Configuration errors: fix the private server key/model/free-tier settings, restart and refresh.
- Gemini quota, temporary service or response errors: try the configured Gemini fallbacks. If they also fail, the error is shown and no substitute location is generated.
- `response_limit`: no partial result is applied. The next configured model may be tried; otherwise, retake the photo and retry.
- Insufficient evidence: provide another view. This is an analysis result, not a transport failure.

Fallback is limited to configured Gemini models; there is no alternate provider or sample-location substitution. Refresh state after an interrupted connection before retrying. Per-photo consent, typed validation, source constraints and visible uncertainty remain required.

## Validation

`npm run test:unit` checks code/API contracts, `npm run build` checks TypeScript and builds production files, and `npm run data:validate` checks official assets. `npm test` additionally runs browser automation with Gemini disabled on isolated port 3100. The user currently requested no further screen checks. No live provider calls are needed for regression tests.

The local service has not undergone a public-hosting review. No deployment or coursework submission has occurred. See [verification](verification.md) and [provider notes](provider.md).
