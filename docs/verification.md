# Verification record

Verified October 16, 2026 on macOS arm64, Node 22.15.1. The current application uses only official Burnaby sources and Gemini photo analysis. Mocked provider results are not evidence of real-campus accuracy.

## Current checks

| Check | Result | Scope |
|---|---|---|
| `npm run test:unit` | **120 passed** | Crop preparation, exact-label, two-stage API, evidence binding and provider/default/failure-chain regressions |
| Earlier `npm test` | **101 passed** | 79 unit/API cases and 22 browser cases after demo removal, before screen checks were stopped |
| `npm run build` | Passed | TypeScript check and Vite production build |
| `npm run data:validate` | Passed | 90 original PDF hashes, 89 geometry records and 631 derived asset hashes |
| Documentation links | Checked | Local references match the current hierarchy |

The automated browser run had already completed when the user requested no further screen checks. No further browser test suite has run. On October 16, the user explicitly requested inspection of a displayed 404; only the existing page's error text was read, with no interactions or photo submission. Future validation should honor the no-screen-test preference. Automated tests use no real Gemini credentials or provider quota; separate live diagnostics are recorded below.

## Removal and regression coverage

Demo selection and browser preference restoration, sample photos, manual fictional landmarks, synthetic routing, destination/checkpoint/closure/replay actions, browser OCR assets/dependencies, and their evaluation tooling were removed. Old mode preferences are cleared, and legacy API actions/session mode overrides are rejected. The source dataset is retained internally. The library screen was subsequently removed as described below.

Tests verify real-only bootstrap/session state; missing-key setup behavior; removed action rejection; consent; actual inline photo bytes and real PNG/geometry evidence in both stages; eligible source IDs; bounded normalized regions; abstention; confirmation; clearing analysis; request idempotency; stale revision/capture rejection; cancellation; no media retention; provider quotas/timeouts/overload/completion limits; blocked/malformed output; and same-origin controls.

Browser tests used installed Chrome with desktop and phone-sized Chromium viewports. Their provider transport was mocked. They covered the real-plan flow, setup state, legacy preference cleanup, camera denial, provider errors without fallback, cancellation and clearing results. Generated images are test artifacts, not proof of live model performance. The upload fixture is an official plan PNG used to exercise transport; it is not labeled as a campus photograph or an accuracy benchmark.

## Source and live-model evidence

All 89 floor plans have full PNGs, overviews and four overlapping detail crops. Eight overview sheets cover the corpus; 89 geometry files hold 566,620 unclassified drawing primitives. Original PDFs and derived assets retain source hashes and attribution. The campus graph/landmark placeholders remain empty.

Earlier live diagnostics accepted the key/model but encountered HTTP 503, timeout, and a token cap. One reproduced HTTP 200 response had `MAX_TOKENS`, no answer parts and 1,726 thinking tokens against the old 1,800-token cap. The adapter now classifies incomplete results and uses low thinking with 4,096/8,192-token photo allowances. A post-fix check timed out and a subsequent check returned HTTP 429, so attempts stopped. See [provider notes](provider.md).

A successful current live photo-to-region match and physical-campus accuracy remain unverified. No new live requests were made during removal of the demo. No extra server was left running on port 3000.

## Remaining work

- Evaluate representative real campus photographs against reviewed ground truth; measure shortlist recall, abstention, incorrect-region rate and latency.
- Verify account tier, model access and actual provider quotas.
- Test physical-phone camera capture, secure HTTPS setup, Safari, accessibility, battery and network behavior when requested.
- Review/field-validate actual campus connections, scale, floor alignment and accessibility before adding routes or ETAs.
- Reconcile the original assignment PDF, which was not supplied, and replace proposal group/member placeholders before submission.

The prior synthetic-routing benchmark no longer describes the current product and was removed. No coursework, site or deployment was submitted/published.


## Gemini 3.6 setup follow-up

The subsequent startup issue was traced to the model allowlist: `.env` correctly contained the key, free-tier confirmation and `gemini-3.6-flash`, but that model was omitted. Official model/pricing/thinking documentation was checked and the model added. A read-only model metadata request using the existing key returned HTTP 200 with `generateContent` support. Configuration now returns `liveConfigured: true` with no setup issue; no generation request was made.

Startup/API/client configuration messages now distinguish a missing key, missing free-tier attestation and an unsupported model without exposing secret values. All 83 code/API tests and the production build passed after this fix. Browser checks were not repeated, per user direction.

The proposal was updated to match the real-plan-only scope and regenerated as two pages. Automated text-boundary checks found no out-of-margin text. Visual inspection was skipped under the user's no-screen-check direction. Group/member placeholders remain; it was not submitted.


## Photo-focused interface

The Campus library component, general catalogue/search endpoint, browse links, promotional intro/banner and empty-state slogans have been removed. Floor-plan assets and Gemini's two-stage image/geometry comparison remain intact. Only plans associated with returned location candidates are passed to the result display; full-plan and source-PDF links belong to those candidates. Geometry JSON remains an internal model input.

All 83 unit/API tests, the production build and source-asset validation passed. API regression checks cover the missing catalogue/search endpoint and continued availability of plan assets for results. Browser test expectations were updated but were not executed, and no manual screen or screenshot checks were performed, per the user's request. The local server is restarted to load the backend changes. No live Gemini generation is required by this change.


## Integration with the latest main branch

The library removal was rebased onto the newer UI/provider changes already on main. The final integration preserves native photo capture, a single best-match result and configured Gemini model fallback behavior while removing library browsing and promotional copy. All 90 unit/API tests, the production build and validation of 90 original PDF hashes and 631 derived assets passed. Browser/screen checks were not run at the user's request; their expectations were updated. No live inference calls were made. The proposal was regenerated from the combined source, with automated page/margin checks only.


## Exact labels and original-image crops — October 16, 2026

Implemented two app API requests: photo-label evidence first, exact source retrieval and visual localization second. All 5,463 extracted labels are indexed and all labels from selected plans are included in model context. The SE12 floor-3 room `302` regression verifies that the formerly omitted label is available and does not match `3021`, `0302`, `302A` or other partial identifiers. Candidate label assertions must match the observed complete identifier and the selected source record.

The browser prepares a context JPEG and four overlapping crops directly from the original decoded bitmap, within the unchanged aggregate 2.5 MB media budget. Node-based unit tests mock canvas primitives to verify original source rectangles, no upscaling, adaptive output bounds and resource release; they are not screen tests. Both model stages receive all five views. First-stage input contains no source-plan hints.

All 114 unit/API tests, TypeScript/production build, 90 source PDF hashes, 631 derived asset hashes and full label-index coverage passed. Tests cover stage-scoped idempotency, two distinct API requests before a result, same-photo/crop/session binding, five-minute evidence expiry, reset invalidation, comparison-only retry, cancellation, complete source labels, preserved no-sign visual matching and Gemini 2.5 thinking-budget compatibility. Provider responses are mocked; no live generation call or user-photo upload was performed. Browser expectations were updated and type-checked but not executed.

This is implementation-contract evidence, not a measured improvement in physical localization accuracy. Next verify the supplied SE12 photo and independent labeled SE12/SW1 photos, recording extraction, shortlist and final-region outcomes separately. Do not reuse evaluation photos as retrieval references. The updated two-page proposal receives automated page/margin checks only, respecting the no-screen-check request.

## Gemini backup 404 diagnosis — October 16, 2026

Read-only model metadata checks returned HTTP 200 with generation listed. Separate text-only forced-tool checks returned 503 for the configured 3.8 Flash primary and 404 for both implicit 2.5 backups. Google's error identified 2.5 generation as unavailable to new users. One replacement-backup check of 3.5 Flash-Lite also returned 503. Four bounded generation diagnostics sent no user photo and produced no usable inference; live photo localization remains unverified.

Defaults now use 3.5 Flash-Lite and 3.8 Flash, preserving explicit primary/fallback settings. Mixed failures retain sanitized original reasons, and an unavailable backup no longer turns a retryable primary failure into an unexplained configuration error. All 120 mocked unit/API tests, production build and source-data validation passed. The first sandboxed test attempt could not bind loopback ports; the complete rerun with local networking enabled passed. No screen tests were run. Provider capacity remains an external limitation.
