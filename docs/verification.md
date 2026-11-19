# Verification record

## SW01 room approaches, confirmed transfers and visitor restrictions

The revision 82 audit covered all 780 SW01 place occurrences. The visitor graph returned a round trip to a building passage for 630 places, including 28 at shared entrances. The original 2016 and 3175 failures now return routes through the visitor planner. The same-floor walk from vestibule 1037 to 1586 and the 3130 door to office 3124 are covered by separate regressions. SW01 S290 to S390 uses the confirmed SW01 stair. The two west entrance walks use separate, bidirectional outdoor edges. Revoking the 3100–3130 door in an isolated editor copy removes the route to the inner office.

The first unfiltered HTTP sample returned two routes out of five. Replaying seed `444e5ee8` after fixing the 1037 double door and the selectable entrances for 1225 returned four routes. The other start, 1494, returned the user's explicit staff-only determination. The source places were retained for both runs. These were post-extraction API checks with no external provider request or independent campus walk. The full suite passed 459 unit and HTTP tests, 26 desktop and mobile browser tests and five offline geometry tests. The build, source validation and Vercel packaging passed. [Per-floor results, marks and unresolved places](sw01-routing.md)

## SW03 and SW01 same-floor transfers, November 18, 2026

After the user confirmed the marked doors, the visitor router returned a route in both directions for each pair below. Each trip started from simulated structured sign readings on the actual floor data. For rooms with multiple entrances, the return trip used the door reached on the outbound trip.

| Floor | SW03 start or destination | SW01 start or destination | Transfer |
|---|---|---|---|
| 1 | Lobby 1602 | Corridor 1290, through vestibule 1098 | Outdoors |
| 2 | Room 2063 | Room 2070 | Indoors |
| 3 | Room 3086 | Room 3080 | Indoors |
| 4 | Room 4075 | Room 4076 | Indoors |

A separate trip from SE12 302 to SW01 3080 traversed the two confirmed third-floor passages and SW03 corridor 3600. Withdrawing the SW03–SW01 floor 3 approval in an isolated copy disconnected that trip segment. Both entrances to SW03 1710 retained their incoming-only approvals when the public lobby became traversable both ways.

An additional first-floor check reached SW01 S190 from SW03 S160. In the opposite direction the visitor can enter SW03 lobby 1602, but reaching S160 from the lobby remains a coverage gap. The S160 marker has no independent walking-grid approach and the existing reviewed traces lead away from that landing.

The full suite passed 433 unit and API tests and 24 browser tests. Three offline compiler tests checked paired door leaves, a protected wall crossing the opening, and rejection of unrelated leaves. The build and source-data validation passed for 89 floor graphs and the revision 49 export. These checks cover routing from sign readings. The crossing directions come from user confirmation. No provider request or independent campus walk was part of this check.

## SW03 locker corridor to SE12 302, November 18, 2026

**Hosted reproduction.** One authorized submission of the original locker-hall photo to the production Gemini extraction stage returned both room numbers, 2695 and 2680, as clear. It classified both as `directional-sign` and reported a straight corridor and two visible doorways. The service recorded four provider attempts including fallback and returned the extraction in 17.6 seconds. With GPS off, the hosted locator returned zero candidates. Its reference list showed both numbers on SW03 floor 2 and only 2695 on SW05 floor 2. The production frontend matched the release for main commit `829e89c` at reproduction time.

**Local recovery.** Replaying those structured readings selects one possible shared corridor and leaves the session location unconfirmed. The visitor API accepts the selection, then returns a walk along SW03 corridor 2600, the east elevator from floor 2 to floor 3, the passage to SE12 and the door to room 302. The first map shades the starting area. Automated checks cover confirmation before navigation, rejection of explicit arrows, duplicate signs, disjoint entrances and stale source bindings. The original photo was submitted once. This check used the floor plans and saved transfers without an independent campus walk.

The local HTTP replay used GPS off. Navigation returned HTTP 409 before confirmation and HTTP 200 with the route after confirmation, with zero additional provider calls. Validation passed with 426 unit and API tests, 24 desktop and mobile browser tests, source-data validation and the Vercel production build.

## Reported sign conflict and SE12 floor transfers, November 18, 2026

The foreground plaque in the supplied photo reads **323**. The screenshot marks **306** on four buildings’ floor plans, including SE12. The additional clear **98** was reported by the teammate. The screenshot does not contain the complete provider response or establish whether a fresh GPS hint arrived.

A deterministic replay against the released resolver produced zero starting candidates for both `323 + 98` and `306 + 98`, even with a fresh SE12 building hint. The old resolver demanded all clear readings on the same page before it applied GPS. The current catalogue has no entry for `98`. The updated resolver offers the supported SE12 floor 3 sign for confirmation, retains the unmatched reading, and prevents routing until selection. An isolated HTTP regression checks this confirmation with a mocked first-stage provider, the original receipt and no second image submission. GPS plus `98` alone identifies only the building.

The released graph had four floor 2–3 stair transfers in SE12. None of their second-floor landing pins had a compiled corridor tie, and the graph had zero internal floor 3–4 transfers. After the user's four A/B confirmations, a clean import of the public revision-45 snapshot routes each three-floor stair chain in both directions. An end-to-end post-extraction check walks from corridor 208Z on floor 2 to corridor 410C on floor 4 via S209, S327 and S418, and returns by the same stairs. The three other floor 2 perimeter approaches remain separate from the indoor corridor network. The stair records have user-confirmation provenance. No live Gemini reproduction or independent campus walk was conducted for this report. Validation passed with 418 unit and API tests, 24 automated desktop and mobile browser tests, the production build and campus data validation.

## Campus-wide source sample, November 18, 2026

The visitor API returned complete routes for **0 of 5** randomly paired journeys. Sampling used all 3,428 indexed place occurrences in graph `3b4497fbb23af67363a67fc5151ac607f2a0287186c10680299fbb7543babe36` and seed `5872ff95`. All ten occurrences were selected without replacement before any route lookup. All five starts localized with simulated exact sign, building and floor readings. The check used no visitor images or provider calls. These results measure post-extraction routing on real source data.

| Origin | Destination | Response |
|---|---|---|
| SE12 F3 305 | SW01 F3 3382A | Destination approach missing |
| NW04 F4 4000A | SW02 F2 250 | Destination approach missing |
| SE12 F4 434 | NE01 F1 5150 (sampled OCR) | Both approaches missing. The source sign reads **S150**, a stair. |
| SE16 F1 117 | SE02 F2 226 | The destination door is known, but its public approach is missing |
| NW05 F2 208 | NE07 F1 143A | Origin approach missing |

The sampled building pairs also lack confirmed interbuilding passages. Correcting an endpoint alone would not connect these five trips. After reading the original signs, the NE01 stair received an exact S150 transcription and overlapping, conflicting OCR identifiers were excluded from the place catalogue. The five samples were retained as observed, with no replacement or additional route trials. The final build was type-checked. Physical campus travel and live photo recognition were outside this sample.



## Earlier SE12 323 starting-route coverage diagnosis

The supplied corridor photo and deployed screenshots showed a clear `323` label, a successful SE12 floor-3 source match, and an `unmapped-origin` response. The production bootstrap reported Gemini with primary configuration `gemini-3.8-flash`; its frontend asset matched the PR #17 build. One authorized reproduction submitted only the original corridor photo to the deployed app with destination SW03 1710. It returned `323` as a clear door label, right-side windows, one reported visible doorway and a straight corridor. Extraction used three provider attempts and a fallback model, taking 34.116 seconds. Metadata-only localization took 877 ms, and the complete check took 35.304 seconds. The response did not expose which fallback model or why earlier attempts failed.

The hosted navigation response used graph revision 41 and returned `origins: []`. SE12 323 had no source doorway annotations, no reviewed starting node and no corridor approach. Its blue marker identified the printed source label, not a camera position or door. Injecting the same clear label into the local resolver with all network/provider calls disabled reproduced the result. The failure was therefore downstream map coverage; Gemini fallback did not cause the graph rejection.

The initial diagnostic change retained the exact anchor label and distinguishes missing doorway/connection data from ambiguous doorways or a broad starting region. Label-only results show **Photo label matched**. Missing coverage shows **Starting route not mapped** without a primary retake-photo action. That diagnostic change covered the message only. The subsequent floor compiler identifies two separate corridor approaches for 323.

All 402 unit/API tests and 24 desktop/mobile browser tests passed, with formatting, production build, source-data validation and Vercel packaging. New tests cover the 323 case with and without fallback metadata, an unmapped connection at an identified door, multiple source doors, and the retained photo action for an ambiguous region. These tests use structured evidence fixtures; the single deployed reproduction is recorded separately above.

## SE12 302 to both SW03 1710 entrances · November 17, 2026

The user clarified the two-floor descent, confirmed the displayed S160 landing A, and corrected the doorway answer to confirm both B (lobby 1602) and C (corridor 1700). Revision 41 adds the third-floor passage-to-S360 approach, the S260-to-S160 descent, and separate source-traced approaches to both 1710 entrances. The existing 28 points, 19 edges and all 27 earlier answers remain unchanged. The new graph has 31 points, 23 edges and 31 answers. New travel permissions follow the described direction toward 1710; reverse travel was not inferred. The two door hypotheses were appended without renumbering the existing 1650 doorway.

The source outlines continue through visible double-door symbols between corridor 1600 and lobby 1602, and between that lobby and corridor 1700. Treating every outline segment as a wall rejected these confirmed approaches. Source-bound doorway apertures now identify the exact drawing primitives and bounded intersections that belong to those openings. An aperture is available to visitor validation only through a current approved corridor trace. Source-hash changes, modified candidate geometry or withdrawn approvals remove that access. Other intersections on the same PDF curve remain checked, and visitor/model responses cannot submit exemptions.

The live local HTTP test with the original `photoooo.jpg` extracted the clear door label `302`, resolved SE12 floor 3, and returned the complete revision-41 route to the lobby-side 1710 door. Extraction took 5.456 seconds, metadata-only localization took 2.786 seconds with a cold source index, and route calculation took 24 ms. The measured workflow took 8.268 seconds with one OpenAI call and no stored media or raw coordinates. The six route legs are the SE12 corridor, third-floor building passage, S360 approach, stairs 3→2, stairs 2→1, and the first-floor approach. A separate isolated graph check withheld each 1710 approach in turn and verified the other confirmed doorway.

All 397 unit/API tests and 24 desktop/mobile browser tests passed, with formatting, production build, source-data validation and Vercel packaging. Regression checks cover both doors, missing stair access, stale aperture approvals, source/primitive/bounds mismatches, malicious client exemptions, and a wall crossing elsewhere on the same PDF curve. Automated provider/device inputs remain mocked; the original-photo check is one live sample, not a physical-campus validation.

## Confirmed SW03 vertical transfers and merge validation · November 17, 2026

The user confirmed both displayed third/fourth-floor facilities and bidirectional travel. Their captured presentation hashes and the unchanged revision-35 journal matched before recording the answers. Revision 37 adds the fourth-floor elevator and S460 landing with two vertical edges, reusing the existing third-floor elevator/S360 nodes. All 25 previous answers remain unchanged; the journal now has 27 answers, 28 approved points and 19 approved connections.

All 386 unit/API tests and 24 desktop/mobile browser tests passed, with formatting, production build, source-data validation and Vercel packaging. The restarted local HTTP API checked both directions of all three SE12–SW03 crossings and both SW03 floor-3/floor-4 transfers. SE12 302 reaches the fourth-floor elevator through four approved connections. These API checks used no provider calls; the photo-driven live test is recorded separately below.

The fourth-floor building-passage endpoint still has no reviewed corridor connection to the fourth-floor elevator or stairs. Stair approaches and individual fourth-floor room approaches also require their own reviews. The API and regression tests continue to report no route for these gaps instead of inferring connections. The confirmed facility transfers do not establish campus-wide coverage, physical distance, accessibility or current operating status.

## Pending SW03 third-to-fourth-floor review · November 17, 2026

Two source-bound questions were prepared for the east elevator and adjacent S360/S460 stairs, with A on floor 3 and B on floor 4. The fourth-floor proposed landing points were read independently from the source drawing. Enlarged A/B pairs were captured from the local review UI with their proposal hashes, source hashes, shared-node versions and graph revision retained in the local review context. Both questions remain unanswered; the approved graph and private review journal are unchanged at revision 35.

Vertical candidates can reuse an owned endpoint from an earlier reviewed connection. This keeps the existing third-floor landing identity when a later user confirmation creates the fourth-floor transfer, and permits a subsequent corridor to reference the newly owned fourth-floor landing. Unanswered proposals create no graph records. Tests simulate confirmations only in isolated temporary journals.

All 383 unit/API tests and 24 desktop/mobile browser tests passed, along with formatting, production build, data validation and Vercel packaging. The source catalogue now contains 20 questions, while the approved graph retains 26 points and 17 connections. No live provider request or field validation was performed.

## Confirmed fourth-floor east passage · November 17, 2026

The user reviewed the captured fourth-floor A/B markers at revision 34, confirmed SE12 B, corrected SW03 A to the east elevator/stairwell entrance, and explicitly confirmed bidirectional travel. Revision 35 moves A from `(0.4875, 0.298)` to `(0.77, 0.585)` on the original SW03 fourth-floor drawing. B retains its plan, source hash and point `(0.44, 0.673)`. The SE12 description now correctly identifies corridor 408C. The earlier hold is superseded by a new user-confirmation receipt, with all 24 previous answers and existing review histories retained.

Both fourth-floor endpoints and their building link now have current approvals and are included in the public snapshot: 26 approved points and 17 connections. The existing record IDs are retained. No fourth-floor corridor, room approach or vertical elevator/stair service is inferred from this confirmation.

All 379 unit/API tests and 24 desktop/mobile browser tests passed, along with formatting, production build, source-data validation and Vercel packaging. New tests check the independently read fourth-floor point in both travel directions, reject the superseded upper-wing receipt, and confirm that the crossing does not fabricate a route to floor 3. The restarted local HTTP API returned the single approved crossing in both directions, and a capture from the actual editor verified the corrected A marker. Provider/device responses in automated tests are mocked; this edit used no additional provider call or physical-campus validation.

## SW03 second-floor east entrance · November 17, 2026

The user reviewed the saved A/B images and corrected SW03 point A from the doorway between 2063/2080 to the east entrance beside 2696/S260. The captured presentation matched editor revision 31 and its source-bound markers before the edit. Revision 34 moves A to `(0.8675, 0.45)` on the corridor side of the east doorway. SE12 point B at `(0.5395, 0.5365)` retains its exact record and approval. The existing outdoor classification and permitted directions remain, with outdoor geometry unmapped.

The elevator approach now uses one shared corridor vertex `(0.8289216, 0.45)` before the existing landing `(0.828922, 0.459848)`. The dependent 2082 approach is also updated to start at the east entrance and follow the existing corridor 2600/2000 vertices to the unchanged office doorway. Both paths pass the drawing-crossing validator. The three affected definitions are version 2, and the private journal retains all 21 earlier answers plus three correction receipts. Original source hashes and unrelated reviews remain unchanged.

All 375 unit/API tests and 24 desktop/mobile browser tests passed, with formatting, production build, source-data validation and Vercel packaging. New cases assert the east entry and unchanged SE12 exit independently, test approaches to both 2605 and 2082, reject the obsolete floor-2 transfer receipt, and verify reverse travel. The restarted local HTTP API returned the corrected direct transfer in both directions at revision 34. A capture from the actual editor verified that marker A appears beside 2696/S260. Automated provider/device inputs are mocked; this correction used no additional provider call and makes no physical-campus validation claim.

## SE12–SW03 east-passage correction · November 17, 2026

The user identified that SE12 floor 3 joins the east side of SW03 beside the displayed elevator marker, rather than the upper corridor. The original proposal had paired SE12 `(0.4435, 0.631)` with SW03 `(0.4875, 0.352)`. Both the local journal and public revision-29 graph reproduced that incorrect pairing with all provider calls disabled.

Revision 31 moves the SW03 passage junction to `(0.77, 0.6325758)` on the original floor-3 drawing, in the east connecting neck beside S360 and shaft 3696. Its corridor approach uses the shared vertex `(0.7401961, 0.6325758)` and the existing elevator landing `(0.740196, 0.640909)`. The long detour through corridor 3000 is removed. The two affected candidate definitions are version 2, the original record IDs and directions are retained, and the local journal preserves all 19 previous answers plus two new user-correction receipts. Source hashes remain unchanged. Superseded candidate definitions no longer authorize visitor transfers, and the public network and trace checksums were regenerated.

The first authorized live `photoooo.jpg` test extracted `302` as a directional sign and correctly abstained before routing. Inspection showed a projecting room-identification plaque next to the visible doorway. The extraction prompt now explicitly distinguishes such plaques from signs with directional arrows or wording; it contains no room-specific or map hints. Directional-only evidence remains insufficient for localization.

The subsequent live test through `http://127.0.0.1:3000` with `gpt-6-luna` extracted `302` with `placement: door`, one doorway, left-side windows and a straight corridor. Extraction took 4.418 seconds, the 117-byte metadata lookup resolved SE12 floor 3 in 3.310 seconds with a cold index, and navigation to SW03 2605 took 20 ms. Total test time was 7.750 seconds with one provider call for the successful request. The returned revision-31 route enters the corrected east passage, takes the short elevator approach, descends to floor 2 and reaches 2605. It never visits the old upper-corridor point. Session results contained no media bytes or raw device coordinates. Across the initial and subsequent live tests, two extraction calls were made in total.

All 371 unit/API tests and 24 desktop/mobile browser tests passed, along with formatting, the production build, source-data validation and Vercel packaging. Regression checks independently assert the corrected passage coordinates in both travel directions, reject an obsolete building-link receipt, preserve shared corridor vertices and retain the old diagonal as a wall-crossing test. Automated provider/device responses are mocked. The two live calls are a small diagnostic sample; no physical-campus walk or additional manual browser check was performed.

## Compact route display · November 17, 2026

Walking directions now use one arrow-separated overview and a continuous vertical stack of floor maps with A/B legends. Transfer endpoints are combined in the overview; floor changes and unmapped outdoor gaps remain explicit. Zoom and source attribution appear once for the stack. Optional device controls are collapsed below it, with an active tracking indicator and an explicit floor selector that stops the previous watch.

All 369 unit/API tests and 24 desktop/mobile browser tests passed, along with formatting, the production build and source-data validation. Regression checks cover map order and vertical placement, shared zoom, endpoint legends, repeat floor visits, zero-step arrival, outdoor gaps and manual tracking-floor changes. Provider and device inputs are mocked. No additional live provider request, manual screen check or physical-campus validation was performed for this display change.

## Single-pass photo extraction and graph routing · November 17, 2026

The visitor now submits media only to the first evidence endpoint. Extracted labels include kind and sign placement, with structured visible-door count, window side and corridor shape. The metadata-only location endpoint resolves the evidence receipt against exact source records and optional fresh GPS building candidates. Raw coordinates remain in the browser. The navigation endpoint calculates exclusively over the current reviewed graph, with explicit gaps when an arrival approach or connecting passage is missing.

The authorized original `photoooo.jpg` was tested through the running local HTTP API using `gpt-6-luna`. One provider call extracted `302` as a clear door sign, one visible door, windows on the left and a straight corridor. Extraction took 3.314 seconds. The following location request was 117 bytes, contained no image, and resolved SE12 floor 3 in 3.012 seconds with a cold source index. The SW03 2605 graph route took 19 milliseconds and contained the five expected corridor, building-passage and elevator legs. SW03 2604 returned an explicit unmapped-arrival result. The provider-call count remained one after both routes and further metadata lookups.

GPS building hints were simulated separately. SE12 corroborated the label match, SW03 produced a conflict, and stored session data contained no image bytes or raw device coordinates. Unit and DOM tests also cover the unchecked state, permission denial, fresh acquisition, repeated-label disambiguation, stale/source-mismatched hints, cancellation and zero downstream inference. This does not validate a physical GPS sensor or campus traversal.

Validation passed with 367 unit/API tests, 24 desktop/mobile browser tests, formatting, production build, data validation and Vercel packaging. Legacy visual-comparison helper tests remain isolated from the active visitor API.


## OpenAI response-length exhaustion · November 17, 2026

The reported local photo comparison returned HTTP 200 from OpenAI but failed application completion checks with `response_limit`. Its first output arrived at 1.864 seconds, and it ended at 46.534 seconds with 8,192 output tokens and zero reasoning tokens. Label reading had completed in 2.122 seconds. This failure happened during photo-to-plan comparison, before destination routing.

OpenAI function tools now use strict schemas with closed objects, required fields, nullable representations for optional fields, bounded text and task-specific array limits. Optional nulls are restored only for fields declared optional before existing validation. Output-limit failures receive one concise regeneration within the existing deadline and token allowance. Metrics include a sanitized incomplete reason, and the visitor error identifies response-length exhaustion.

An authorized live check with the same original photo completed comparison in 7.235 seconds using 595 output tokens and selected the 302 doorway vicinity. The screenshot destination `SW03 2604` resolves to a floor-2 vestibule with no reviewed door approach. Its subsequent AI route request returned `no-route`. The existing approved route ends at the distinct 2605 doorway. All 353 unit/API tests and 24 desktop/mobile browser tests passed, along with production build, data validation, formatting and Vercel packaging. The live result is a single successful comparison and does not establish general localization accuracy.

## Complete reviewed visitor routes · November 17, 2026

The reported SE12 302 to SW03 2605 failure occurred while the complete revision-29 reviewed route was present. The visitor endpoint called only the AI planner, which could abstain despite that path. `planVisitorNavigation` now returns a complete current reviewed route first when the photo-derived area uniquely binds its start and the destination resolves to its reviewed approach. It uses the existing eligibility, source-hash, endpoint-version, direction and corridor-trace checks, followed by drawing-crossing validation. Additional coverage still uses the AI planner, with current reviewed stair/elevator connections supplied explicitly.

The stored path is the 302 corridor, the third-floor SE12–SW03 passage, the SW03 third-floor corridor, the east elevator to floor 2, and the corridor to 2605. All five connections have current approvals, and their walking polylines pass drawing-crossing validation. Regression tests cover model abstention, withdrawal of the elevator approval, an out-of-region photo start, and an additional destination requiring AI interpretation. The visitor API regression rejects any unexpected route-generation model call for the complete reviewed path.

All 350 unit/API tests and 24 desktop/mobile browser tests passed, with the production build, data validation and Vercel package build. Two authorized live runs reused the same original hallway photograph with `gpt-6-luna`. The first comparison returned unusable structured evidence and was discarded. The second supported the 302 doorway vicinity and returned the complete SW03 2605 route in 11.339 seconds overall, with 22 milliseconds after photo analysis and zero route-generation model calls. This is one successful live journey and does not establish general localization accuracy or physical-campus validation.

## AI latency, payload and recovery · November 17, 2026

Provider calls now share absolute stage deadlines. Reading labels uses 45 seconds, visual shortlisting and comparison share 90 seconds, and route generation uses 90 seconds. The browser permits ten additional seconds per stage. A controlled 31-second response completes under the new 90-second budget, while a second request started 70 seconds into that budget is cancelled after the remaining 20 seconds. Transient OpenAI/Groq failures receive at most one retry when the remaining time and request budgets allow it. A DOM regression verifies that a failed comparison reuses its original label evidence on retry.

Validation passed with 346 unit/API tests and 24 desktop/mobile browser tests through `npm test`, plus formatting, the production build, source-data validation and Vercel packaging. Stream tests exercise split UTF-8/SSE frames, completion-only parsing, cancellation after the first event, bounded retries and redacted success/failure metrics.

Exact source references select an overview and matching doorway or label-context crops. All extracted labels retain their exact text, coordinates and source methods in compact geometry. Unlocated pages keep quadrant coverage, and shortlist overviews fit within 900 pixels. Success and failure telemetry records request counts, image dimensions, bytes, preparation/header/response timings, provider request IDs and available token counts. OpenAI SSE is consumed through completion before validating output. Stream cancellation and incomplete responses are covered by regression tests.

Two live baseline and two optimized runs used the same user-authorized 302 hallway photograph with `gpt-6-luna`. The comparison input fell from 11 images and about 2.51 MB to 7 images and about 2.04 MB. Input tokens fell from 34,712–34,716 to 26,493–26,507, approximately 24 percent. Baseline comparison calls took 6.31–6.48 seconds, and optimized comparison calls took 6.53–6.87 seconds. All four comparison calls completed within their deadlines. This small sample demonstrates input reduction and successful transport, with no claim of faster inference or a representative p95.

Both baseline runs and the first optimized run abstained on location. The second optimized run returned an unverified SE12 floor 3 doorway hypothesis and proceeded to route generation for `SW03 2605`. That request completed with `no-route` after a correction attempt. Successful real-photo route generation and physical-campus accuracy remain unverified. The original photograph is outside the repository and was not added to fixtures or application storage.

## Invalid route response recovery · November 17, 2026

The reported local request for `SW03 1710` displayed the generic source-validation rejection before drawing-stroke checking. Exact retrieval finds one plan-read occurrence on `SW3-F1-p1`, labeled `1710` with lecture space use. The earlier provider payload was not retained, so the individual failed source constraint cannot be recovered from the screenshot. Photo-location acquisition and route generation are separate AI requests.

Route generation now limits destination IDs to the retrieved source occurrences and gives malformed or source-invalid responses one correction attempt under the same 30-second deadline. Final messages distinguish wrong floors, start areas, room endpoints, disconnected steps and invalid mapped crossings. The visitor can retry the route using its existing photo-derived area without submitting the photo again. Regression cases use the exact `1710` source occurrence to check floor-1 retrieval and rejection of an incorrect floor-2 proposal. Corrected successful routes use the existing source-bound corridor fixtures. Live photo-to-1710 route success remains unverified.

All 334 unit/API tests and 24 desktop/mobile browser tests passed, with mocked AI responses. Production build, source-data validation, formatting and Vercel packaging passed. The DOM integration test checks a rejected route followed by **Retry route**, and verifies that only the original two photo-stage requests contain images.

## Source-drawing crossing regression · November 17, 2026

The reported SW03 floor 3 diagonal was reproducible using the source passage and stair points. The AI route validator had checked endpoints and step continuity while accepting the intervening straight line. The earlier transport fixture also used endpoint-only lines, so its passing results did not test corridor geometry. The map renderer drew the supplied polyline faithfully.

The planner now receives the six source-traced corridor polylines and checks every displayed floor path against the complete extracted long-stroke list. Geometry checks combine consecutive corridor steps and include their marker connections, preventing shortcuts hidden by a waypoint or step boundary. A rejected path receives one regeneration attempt within the existing 30-second deadline. A second crossing produces an explicit unavailable result. The hosted bundle includes the same hash-bound stroke data.

All 325 unit/API tests and 24 desktop/mobile browser tests passed. The production build, source-data validation and Vercel package build passed. New cases cover the passage-to-stairs diagonal, split-line bypasses, corrected regeneration and preservation of all six existing corridor traces. Successful mocked route responses now contain the source corridor bends. AI inference is mocked, and the attached screenshots supplied visual evidence. Live provider behavior and physical-campus accuracy were not measured. The drawing strokes remain unclassified, with possible conservative rejections of annotations and no proof of physical walkability.

## Routing regression review · November 17, 2026

The updated visitor flow passed 311 unit/API tests and 24 desktop/mobile Chrome browser tests through `npm test`, plus the production build and source-data validation. AI responses are mocked. The DOM integration test also mocks photo preparation. Browser tests prepare a source-plan image as a transport fixture, with captures written under the ignored `test-results/` directory. Live provider behavior and physical-campus route accuracy remain unmeasured in this review.

New AI planner tests cover floor-by-floor output, routing between source labels without approved indoor checkpoints, unknown destinations, invalid coordinates, disconnected steps, invented building links, withdrawn approvals and one-way crossings. A reproduced race allowed a building link withdrawn during generation to remain in the response. The planner now rejects topology revision changes during the provider call with HTTP 409. Existing photo, API and browser assertions follow the automatic starting-area selection and Photo → Next → Destination → Go flow.

Route validation checks source-plan membership, endpoint regions, step continuity and mapped building connections. The generated floor paths and stair/elevator locations still depend on the provider's interpretation of the drawings. These checks do not establish wall clearance or physical walkability.

## AI route generation without approval prompts · November 17, 2026

Visitor navigation now asks the selected provider to choose the destination occurrence and generate start/end points and floor paths from official plans. Room checkpoints, door bindings and corridor reviews no longer gate visitor routes; only mapped inter-building links constrain building transfers. The visitor panel no longer offers destination-occurrence selection, and the starting-position notice appears before the route request completes. One-character destination typos are matched against source labels across the pilot, independent of manual door bindings.

`npm run format`, `npm run build` and `git diff --check` passed. No automated tests, live provider request, browser check or physical-campus validation were run for this change.

## Selectable OpenAI provider · November 17, 2026

At the time of this provider migration, the workflow required exact source retrieval, visual comparison and user confirmation, with image-free session storage. All 295 unit/API tests passed with mocked provider transport. New coverage checks server-only provider selection, Gemini defaults/free-tier checks, the `luna-6.0` alias, paid OpenAI configuration, per-photo recipient disclosure, Responses image/tool serialization, output completion/refusal validation, bounded retries, cancellation, request budgets and the then-current visitor API.

`npm test -- --list` ran the unit/API suite and listed browser tests without executing them, preserving the requested skip of screen checks. `npm run build`, `npm run data:validate` and `npm run format` passed. Dependency installation was restored from the existing lockfile. Local loopback and topology initialization required normal filesystem/network permissions after sandbox-only attempts failed. No live OpenAI request, new live Gemini comparison, browser/screenshot check or physical-campus validation was performed. The private environment remains on Gemini with a blank OpenAI key placeholder.

## Optional device location · November 16, 2026

The device-location change passed 259 unit/API tests, production build/type checking and source validation. New checks cover photo association, coordinate privacy, walking lifecycle, floor confirmation, source hashes and projection geometry. Provider and device inputs are mocked. Browser/screenshot checks were skipped as requested. Physical-phone behavior and indoor accuracy remain unverified. SE12 floor 3 has an approximate overlay. Eleven floor calibrations remain unresolved. [Coverage and evaluation](device-location.md)

## English checkpoint labels and existing reviews

Revision 29 uses English labels for all 24 approved checkpoints and 16 passages. A migrated journal produced the five-step route from SE12 room 302 to SW03 room 2605. The visitor form test also checks the start button, transfer points and floor directions for the 302-to-2082 route using mocked photo inference. Migration tests check one-way travel, withdrawn or stale approvals, original review fingerprints, all six corridor traces and four room-door bindings. The local journal retained its 19 marked-point answers and six floor-service observations through the upgrade. No physical walk or live Gemini inference was part of these checks.

## Visitor route overview

The revision 28 distributable network includes the two user-approved approaches for SE12 302 and SW03 2082. A fresh editor initialized from that network produces the same continuous indoor journey. A Node DOM integration test exercises the normal visitor form, verifies that selecting the photo starts no provider call, submits the photo and destination with one button, and selects the marked starting door once. With the real session and navigation APIs and mocked image preparation and Gemini inference, the first result shows three source sheets in walking order, three walking lines, the building passage, the elevator transfer and arrival at 2082. The test switches between all floors and manual floor navigation, then edits the destination and checks that the old route disappears without a new model request.

All 240 non-browser tests, the production build and data validation passed. The local server loaded the new start-selection endpoint and the two current bidirectional approvals. No additional live photo submission, browser layout check or physical walk was part of this change.

## Two proposed room approaches for SE12 302 to SW03 2082

The two marked A/B questions match the official SE12 third-floor and SW03 second-floor drawings. Both were loaded as unanswered against topology revision 25. The approved graph still contained 22 eligible points and 14 eligible passages before review.

An isolated copy of the published graph exercised the visitor route from the 302 doorway hypothesis to the exact 2082 office. It confirmed that a single approval or unknown direction leaves the route incomplete, two forward-only approvals provide the requested journey only in the forward direction, bidirectional approvals enable the reverse trip, and a subsequent F withdraws the room approach. The test uses the reviewed indoor building crossing and east elevator and checks that the final corridor stops at 2082 without doubling back to the exterior door. These fixture answers are not physical observations. All 238 non-browser tests, the build and source-data validation passed.

## Doorway and corridor localization

The preceding binary decision accepted a model camera rectangle or returned only printed-label references. It could not retain a supported doorway vicinity when the model abstained on the rectangle or when the rectangle failed validation. That implementation retained neither the individual validation reasons nor a doorway assessment, so the specific branch taken by the earlier live hallway request cannot be reconstructed.

The new comparison offers each eligible source doorway with its own unmarked crop from the hash-checked drawing. All 19 annotated doors across SE12, SW03 and SW01 produced source views. The test suite covers the same workflow in all three buildings, competing entrances, an adjacent second label, missing or contradictory visual evidence, and the difference between a starting hypothesis and a reviewed routing origin. The 237 non-browser tests, TypeScript and production build, and data validation passed.

One authorized live application workflow used the original hallway photograph and its four detail views. No building, floor, room or destination hint was supplied. Gemini read 302, then selected the mapped 302 doorway on SE12 floor 3 on the basis of the signed door opposite exterior glazing and the drawn exterior-facing corridor. The server returned a low-confidence, unconfirmed doorway-vicinity candidate. The original-page frontage bounds were [0.10691, 0.5821, 0.16431, 0.60288]. The label-reading HTTP stage took 22.1 seconds and the comparison took 12.8 seconds. Source-room and door positions are known, while the exact camera point and heading remain unmeasured. The 302 doorway has no current binding to a reviewed walking connection. This single live photograph does not establish general localization accuracy.

## SE12 floor 3 photo overlay — November 13, 2026

The hallway photo supplied by the tester shows a sign reading **302 Classroom** above the open door on the right, with exterior windows on the left. The tester reported the app showed `Read room label 302`. That status uses the clear first-stage photo reading before floor-plan retrieval. Both observations identify 302. The previous diagnosis of a 320-to-302 reading error was incorrect.

On the original SE12 floor 3 sheet the printed 302 is centred at approximately (0.135, 0.542), with a drawn doorway at (0.1508, 0.5821). Coordinates are fractions of the full page from its top left. The reported orange box covered x = 0.08–0.30 and y = 0.30–0.48. It ended above both the printed room number and its doorway. Its footprint included labels 301, 303 and 307. The room entrance opens onto the corridor along the lower edge of this part of the plan. The photo supports the vicinity of this entrance. Its exact camera point and heading are unmeasured. The source index contains no exact `800C` occurrence on this floor.

A controlled replay of the pre-fix code at `0170d12` used a test provider to inspect the request assembly. A clear reading of 302 retrieved the original PDF text, the overlapping optical reading and the manual transcription at the same room. The second stage received those positions, five plan images and the full 285-label geometry. Supplying the reported rectangle and explanation as the model response allowed the old server to display them. The application checked the label and floor but did not check the relationship between the returned rectangle and the source positions. The original provider response was not retained; the model's reason for choosing that rectangle is unknown.

The tester authorized one new comparison of the original hallway photo through the local visitor UI and Google Gemini. The destination field was empty and no room or building hint was supplied. The first stage displayed `Read room label 302`. The final screen showed SE12 floor 3 and a blue printed-label reference at (0.135294, 0.542424). Its outcome was `Camera position unresolved`, with zero camera candidates and no orange overlay. The UI indicated a backup Gemini model was used. This live result does not establish a precise camera point or the model's reasoning during the original run.

All 230 non-browser tests, the production build and source-data validation passed. Regression cases use the correct 302 reading, the reported rectangle and the drawn 302 doorway. The wrong rectangle is also checked on its own with the corridor claim removed, while a mocked architectural match at the correct doorway remains eligible for user confirmation. Room 320 and a generated 320 card remain separate controls for source references and sign-only abstention. The visitor's photo was not added to the test suite or routing data.

## Photo response timing — November 13, 2026

The in-app browser displayed a Gemini connection/timeout error before route lookup. The original error did not distinguish the stage or the cause. On the same local server, a separately generated number card passed the two live Gemini API stages. Before the change the evidence request took 31.6 seconds and the comparison took 32.4 seconds, with two provider attempts per stage. After restarting with the fix, the same card took 14.5 seconds and 11.1 seconds respectively, with one attempt per stage. These are individual observations under variable service load. A card bearing a room identifier has no known camera position on campus and cannot validate localization accuracy. The visitor's original photo was not resubmitted during diagnosis.

All 220 non-browser tests, the production build and data validation passed. Mocked tests exercise slow and failed model requests, the next stage reusing a working fallback, cooldown expiry, and renewal of a lost local session. The live run exercised the successful primary-model path.

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
