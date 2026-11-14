# Verification record

## Visitor walking routes — November 13, 2026

The user confirmed both directions between each SW03 east elevator landing and the specified classroom door. Revision 25 contains 22 eligible points, 14 passages and four source-bound corridor traces. The floor 2 door is the 2605 entrance opposite vestibule 2604. The floor 3 door serves 3615 opposite vestibule 3604. Both answers have a user-confirmation basis and no field observation date.

All 214 non-browser tests passed with Node 22.15.1. A fresh-checkout regression verifies the public network produces the same four drawable corridors and two room-door approaches, and that local withdrawals survive restarting the editor. A mocked Gemini HTTP journey submits a consented photo, checks the twelve eligible source plans, confirms a region and a starting point, and obtains room-to-room directions. Regression checks cover the reverse route, one-way review changes, a moved door, ambiguous labels, an unreviewed SW01 door, an unknown room and an outdoor crossing with no intermediate geometry. Server-rendered React checks exercise the map overlay. The TypeScript and production build passed. Data validation verified 90 source PDFs, 631 derived image and geometry assets, and the four corridor traces.

The requested [mobile landing capture](../outputs/screenshots/landing-mobile-390x844.png) shows a 390 × 844 Chrome emulation with the configured local server. The local server passed its readiness check. Live Gemini generation, visitor screen checks, physical-device testing and independent campus traversal were outside this verification run. The floor plans and user reports do not measure real-photo localization accuracy or walking distance.

## Three-building spatial retrieval — November 13, 2026

The release branch passed 146 non-browser unit, HTTP and provider tests on macOS arm64 with Node 22.15.1. The production build and data validation passed. The latter checked 90 original PDFs, 631 derived assets, 12 pilot source and geometry bindings, 16,659 optical observations, 377 plan transcriptions, and the approved revision 23 graph. The private editor export reproduced the published 20 checkpoints and 12 passages. A traversal test followed the same five reviewed edges in both directions.

Source checks used all 12 official pages, including enlarged original PDF details. A regression set queries two additional printed identifiers per floor. Missing `SW03 2458`, an ambiguous `S300`, marginal dates and the erroneous SW01 OCR reading `302` all produce the documented outcomes. The photo tests mock Gemini. Browser checks were skipped under the existing screen-check preference. Physical localization accuracy and complete room-to-room walking coverage are unmeasured. [Coverage and interpretation](spatial-retrieval.md)

## App rename — November 12, 2026

The app, package metadata, server messages, documentation and two-page proposal now use DirectionallyUnchallenged. Header, footer and dialog browser expectations were updated; the Node-rendered photo privacy notice also asserts the new name. Formatting, all 130 mocked unit/API tests, the production build and source-data validation passed on Windows. `npm test` reached browser tests after passing unit/API tests, but all 24 browser cases stopped before launch because the configured Chrome installation was missing. No manual screen checks, live Gemini calls or physical-campus checks were performed. Historical screenshot artifacts were not regenerated. Proposal text, metadata and page count were checked without visual inspection.

Verified October 20, 2026 on macOS arm64, Node 22.15.1. The current application uses only official Burnaby sources and Gemini photo analysis. Mocked provider results are not evidence of real-campus accuracy.

Latest automated checks: November 13, 2026 on macOS arm64, Node 22.15.1. The current application uses only official Burnaby sources and Gemini photo analysis, plus a separate topology editor with candidate confirmation. Mocked provider results and artificial graph annotations are not evidence of real-campus accuracy.

## Current checks

| Check | Result | Scope |
|---|---|---|
| `npm run test:unit` | **184 passed** | Photo/provider tests and 58 topology tests covering candidate answers, endpoint reuse, routing, HTTP access and Node-rendered review controls |
| Earlier `npm test` | **101 passed** | 79 unit/API cases and 22 browser cases after demo removal, before screen checks were stopped |
| `npm run build` | Passed | TypeScript check and Vite production build |
| `npm run data:validate` | Passed | 90 original PDFs, 89 geometry records, 631 derived asset hashes and all 5,463 extracted labels. Revision 21 has 22 points, 11 edges, 10 eligible edges, 14 questions, 12 marked-point answers and six floor observations. |
| Documentation links | Checked | Local references match the current hierarchy |

The automated browser run had already completed when the user requested no further screen checks. No further browser test suite has run. On October 16, the user explicitly requested inspection of a displayed 404; only the existing page's error text was read, with no interactions or photo submission. Future validation should honor the no-screen-test preference. Automated tests use no real Gemini credentials or provider quota; separate live diagnostics are recorded below.

## Removal and regression coverage

For the first continuous route, revision 21 returned no route between the SE12 floor 2 exterior doorway and its floor 3 SW03 passage. The two proposed SW03 corridors had no answers. In temporary test data, approving both corridors in the forward directions produced the expected five-edge route using the existing points. The reverse route became available after its one-way constraint was changed to bidirectional. Withdrawing a corridor disconnected the test journey. These checks used mock confirmations. The saved campus graph was read only.

The November 13 stair and elevator review used the four original floor plans and BCIT's campus accessibility map. Seven stair pairs and one SW03 elevator pair have page-specific markers. SE12 elevator service is a floor inquiry with unknown boarding positions. The running editor/API returned HTTP 200 and nine unanswered floor 2–3 questions. The saved graph retained its original SHA-256 throughout this change.

All 180 non-browser tests and the production build passed. New fixture tests cover review of each vertical mode, same-floor rejection, reverse-only routing, full-page elevator inquiries and subsequent confirmation with two independently supplied positions. Physical passage and elevator operation await user review. Application screen checks were skipped per the project preference.

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

## Internal topology editor — November 12, 2026

Added a separate local-only editor for the 12 official SE12/SW3/SW1 plans. It supports page-normalized manual points, explicit same-floor/inter-floor/inter-building/outdoor connections, direction, evidence, dated field observations, human review decisions/history, optional measured distance, JSON backup export and persistent revisioned storage. The initial topology file is empty. Existing photo input and two-stage Gemini localization behavior remain unchanged.

All **151 unit/API tests** passed, including 25 new cases. These use temporary artificial annotations and mocked provider behavior, not real-campus topology. Checks cover storage across reloads, content/source/endpoint review binding, invalidation of approvals after edits or withdrawal, rejected/unreviewed shortcuts, one-way paths, measured versus unknown costs, deletion, concurrency/locks, invalid input, normalized coordinates and local-only access. Raw annotation files are blocked before the development/static fallback. The first sandboxed run could not bind localhost ports; the full suite passed with local networking enabled. A Host-header test was corrected to use raw HTTP because fetch replaces that header.

`npm run build`, `npm run data:validate`, `npm run format` and `git diff --check` passed. Source validation still covers all 90 PDFs and 631 generated assets; topology validation reports revision 0, zero points, zero connections and zero eligible routing edges. No original source assets or pre-existing survey outputs were changed.

Per the existing user instruction, **no browser, screenshot or manual screen checks were run**, so `npm test` (which includes Playwright) was not invoked; the complete non-browser suite was run instead. The editor's rendering and interactions still need user screen feedback. No live Gemini generation, user-photo upload, physical-device check or physical-campus traversal was performed. At that editor-only milestone, the route checker computed paths over manually approved topology. See the visitor pilot entry above for the subsequent integration.

## Candidate confirmation — November 13, 2026

The default internal view now presents A/B points on two original floor plans and accepts T/F/unknown, followed by an explicit permitted-direction answer after T. It supports point/floor correction, stored answer history, nickname/name attribution and a direct route-check handoff. T with a known direction atomically approves the marked endpoints and passage as user-confirmation evidence, without fabricating a field visit or measured distance. F, unknown and unknown direction cannot enable a route and withdraw previously generated candidate connections. Existing manual annotation remains available.

Two initial SW03–SE12 third-/fourth-floor hypotheses were prepared by reading the official overview/detail PNGs. This was source-evidence inspection, not application screen testing or field validation. Each proposal has exact original-source hashes, page-normalized points and a rationale describing its uncertainty. The actual topology still has zero points, zero connections and zero answers; none of the candidate questions was answered on the user's behalf. All source images and geometry remain unchanged.

All **171 non-browser tests** passed, including 20 new candidate/API regressions. Temporary mock answers verify forward/reverse/bidirectional routing, unknown-direction exclusion, F versus unknown histories, exact presentation/source binding, corrected floor/point persistence, revision conflicts, non-duplication, manual edit invalidation, unaffected adjacent passages, preservation of legacy documents, and exclusion of unreviewed measurements. Node rendering checks the paired-source questions and explicit direction controls; it does not validate browser interactions or layout.

The production build, formatting, source/topology/candidate validation, documentation links and whitespace checks passed. The owned local server was restarted as a detached process. Read-only localhost requests returned HTTP 200 for the editor, its API and the transformed component module; the API reported two unanswered candidates and an empty graph. Direct candidate-catalogue access returned HTTP 404. No browser, screenshot, manual application screen, live Gemini generation or physical-campus checks were run. No deployment or push occurred.


## Floor correction and second-floor outdoor proposal — November 13, 2026

The user corrected the SE12–SW03 connected levels to 2 and 3 and explicitly said the second-floor journey exits one building and enters the other via outdoors. The reported ground-adjacent portion of SE12 floor 2 is recorded as context only; no entrance position, global elevation, floor renumbering, distance or accessibility inference follows from it.

Through three revision-checked editor API operations, the previous fourth-floor points and edge were returned to draft with assistant-attributed notes recording the user's correction. Their original T answers and review history were preserved, and no fourth-floor coordinate was reassigned to floor 2. The third-floor bidirectional edge remains eligible. The saved graph is revision 6 with four points, two saved edges, one eligible edge and three original user answers.

A third source-bound proposal was added using new inspections of the official SE12/SW03 second-floor PDFs, rendered locally at 300/600 dpi. It uses `outdoor-access` points and an `outdoor` passage kind. Its exact door positions remain unanswered and have not been added to the route graph. The question now explicitly asks about walking outdoors between the marked doors. Original source and derived runtime assets remain unchanged.

All **173 non-browser tests**, the build, formatting, data/candidate validation, documentation links and whitespace checks passed. Two added regressions cover the outdoor floor-2 prompt and preservation of historical floor-4 coordinates/answers while retaining the floor-3 route. These tests use temporary fixtures, not physical-campus evidence. The local server was restarted and its page/API returned HTTP 200, showing the new outdoor candidate, retained third-floor confirmation and fourth-floor re-review state. No browser/screenshot/application screen checks or live provider calls were made; source-image inspection was limited to candidate preparation. No physical campus verification, push or deployment occurred.

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

## Inline photo input — October 20, 2026

Find my location is now the first screen's heading, with Upload photo and Take a photo directly available. The location dialog and its launcher are removed. A selected photo reveals the consent and analysis controls; results appear once below the input. Remove photo and Cancel analysis release local media and invalidate late work. Confirmation releases the photo while retaining the selected result. The separate coverage/privacy dialog preserves the photo and consent.

All 126 unit/API tests, production build and source-data validation passed. Six new Node-only component rendering tests cover initial controls, native capture, preview/consent gating, missing configuration and the availability of cancellation controls during preparation/analysis. Existing request-gate tests cover invalidation of stale work. Browser expectations were updated for the inline flow and privacy dialog but were not executed; no browser, screenshot or manual screen checks were performed. No live Gemini request or user-photo upload was used. Visual feedback from the user is pending before PR/merge work.

## Windows geometry hash repair — November 12, 2026

The reported comparison failure occurred after label reading because all 89 geometry JSON files had Windows CRLF endings. Converting only CRLF to LF reproduced every original indexed SHA-256 exactly. Those original bytes were restored without changing source PDFs, expected hashes, labels or geometry content. Checkout attributes now preserve LF geometry and binary PDF/PNG bytes; the visual generator writes UTF-8/LF bytes explicitly. Three record schemas now specify string keys as required by the installed Zod version.

All **130 unit/API tests**, the production build and data validation passed on Windows: 90 original PDF hashes, 89 geometry records, 631 derived asset hashes and all 5,463 indexed labels. New regressions verify every derived asset's exact bytes and ensure runtime geometry loading rejects both CRLF conversion and content changes before accepting the restored room `302` source. The initial sandboxed HTTP tests could not connect to localhost; the full rerun with local networking enabled passed.

`npm test` was not run because it includes browser checks; `npm run test:unit` ran the full non-browser suite. No browser, screenshot, manual screen, live Gemini or physical-campus checks were performed. These mocked-provider tests do not establish live localization accuracy. Restart the existing server to load backend changes before retrying the photo.
