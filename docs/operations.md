# Operations and privacy

## Setup

Use Node.js 22+, `npm ci`, and `npm run dev`. The app defaults to `127.0.0.1:3000`; frontend edits can refresh through Vite HMR on the existing listener. The Node server does not restart automatically for file changes. Restart it manually after backend, environment or regenerated data changes. A duplicate launch fails clearly; do not start another instance on the same port.

Set `GEMINI_API_KEY` in private `.env`, choose a primary `GEMINI_MODEL`, and set an ordered comma-separated `GEMINI_FALLBACK_MODELS` list. Defaults use Gemini 2.5 Flash-Lite and Gemini 2.5 Flash; Google currently lists both on the free tier. Verify eligibility and model access for the specific API project before setting `AI_FREE_TIER_CONFIRMED=true`. `.env.example` is a keyless template. Never put secrets in frontend variables. `AI_DEFAULT_MODE` is obsolete and ignored. No mode switch or synthetic location fallback exists.

Without provider configuration, users see setup guidance and can browse official PDFs/PNGs/geometry. Photo submission is disabled in the client and rejected by the server. With configuration, each photo still requires consent and an explicit Analyze action.

## Media and state

The browser accepts JPEG/PNG/WebP up to 8 MB and 50 million pixels, resizes to a 1,600-pixel long edge, and re-encodes JPEG without original metadata. The server limits photo bodies to 4 MB and decoded image bytes to 2.5 MB. The photo goes transiently to Google after consent; the application saves no media to disk, caches or session logs. Google free-tier handling is disclosed under its terms.

Mobile photo capture uses the browser/device photo picker. CampusLens does not open a live camera stream or track movement. Physical-device capture behavior remains unverified.

Session results expire after 30 minutes. Reload creates a new session. Clear analysis removes the current result. No accounts, saved positions, browser location history or automatic tracking exist. Obsolete mode preferences are removed from browser storage. API responses use `no-store` and reject cross-origin requests.

## Failures and recovery

- Configuration errors: fix the private server key/model/free-tier settings, restart and refresh.
- Gemini quota, temporary service or response errors: try the configured Gemini fallbacks. If they also fail, the error is shown and the plan library remains available.
- `response_limit`: no partial result is applied. The next configured model may be tried; otherwise, retake the photo and retry.
- Insufficient evidence: provide another view. This is an analysis result, not a transport failure.

Fallback is limited to configured Gemini models; there is no alternate provider or sample-location substitution. Refresh state after an interrupted connection before retrying. Per-photo consent, typed validation, source constraints and user confirmation remain required.

## Validation

`npm run test:unit` checks code/API contracts, `npm run build` checks TypeScript and builds production files, and `npm run data:validate` checks official assets. `npm test` additionally runs browser automation with Gemini disabled on isolated port 3100. The user currently requested no further screen checks. No live provider calls are needed for regression tests.

The local service has not undergone a public-hosting review. No deployment or coursework submission has occurred. See [verification](verification.md) and [provider notes](provider.md).
