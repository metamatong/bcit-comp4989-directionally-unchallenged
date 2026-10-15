# Operations and privacy

## Setup

Use Node.js 22+, `npm ci`, and `npm run dev`. The app defaults to `127.0.0.1:3000`; development reloads share the same listener. A duplicate launch fails clearly. Restart the existing server after backend, environment or regenerated data changes. Do not start another instance on the same port.

Set `GEMINI_API_KEY` in private `.env`, use a reviewed model and attest the project's free tier with `AI_FREE_TIER_CONFIRMED=true`. `.env.example` is a keyless template. Never put secrets in frontend variables. `AI_DEFAULT_MODE` is obsolete and ignored. No mode switch or synthetic fallback exists.

Without provider configuration, users see setup guidance and can browse official PDFs/PNGs/geometry. Photo submission is disabled in the client and rejected by the server. With configuration, each photo still requires consent and an explicit Analyze action.

## Media and state

The browser accepts JPEG/PNG/WebP up to 8 MB and 50 million pixels, resizes to a 1,600-pixel long edge, and re-encodes JPEG without original metadata. The server limits photo bodies to 4 MB and decoded image bytes to 2.5 MB. Photos and optional descriptions go transiently to Google after consent; the application saves no media to disk, caches or session logs. Google free-tier handling is disclosed under its terms.

Rear-camera preview requests video without audio. Streams stop on unmount or when the app is hidden. Capture does not automatically submit a frame. Camera preview needs HTTPS or localhost; file upload remains available on denial. Physical phones, Safari, secure LAN camera access and battery behavior remain unverified. [MDN camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Session results expire after 30 minutes. Reload creates a new session. Clear analysis removes the current result. No accounts, saved positions, browser location history or automatic tracking exist. Obsolete mode preferences are removed from browser storage. API responses use `no-store` and reject cross-origin requests.

## Failures and recovery

- Configuration errors: fix the private server key/model/free-tier settings, restart and refresh.
- HTTP 503 or connection timeout: retry later. The plan library remains available.
- HTTP 429: wait for the applicable quota window. Rapid repeated clicks do not fix provider limits.
- `response_limit`: Gemini stopped before finishing; no partial result was applied. Retry explicitly, optionally with a building hint if actually known.
- Insufficient evidence: provide another view. This is an analysis result, not a transport failure.

No provider/model or sample-location substitution occurs. Refresh state after an interrupted connection before retrying. Per-photo consent, typed validation, source constraints and user confirmation remain required.

## Validation

`npm run test:unit` checks code/API contracts, `npm run build` checks TypeScript and builds production files, and `npm run data:validate` checks official assets. `npm test` additionally runs browser automation with Gemini disabled on isolated port 3100. The user currently requested no further screen checks. No live provider calls are needed for regression tests.

The local service has not undergone a public-hosting review. No deployment or coursework submission has occurred. See [verification](verification.md) and [provider notes](provider.md).
