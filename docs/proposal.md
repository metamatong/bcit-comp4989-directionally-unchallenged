# CampusLens

## An evidence-first campus wayfinding agent

**COMP 4989 | Group [NUMBER] | Members [NAMES / STUDENT IDS]**
**Proposal draft | October 15, 2026 | Non-binding scope**

### 1. Novel AI agent use case

CampusLens helps students establish a possible location from a photograph on BCIT's Burnaby campus. One agent compares the actual image with official floor plans and structured drawing geometry, retrieves plausible pages, and proposes source-linked regions for user review. It can abstain when repeated corridors or missing features make the scene ambiguous. The use case combines visual evidence, transparent uncertainty, source provenance, and bounded agent actions.

The Live flow is photo → visual plan shortlist → detailed image/geometry comparison → single best-supported region or abstention → confirmation. Readable signs are optional. There is no demo mode, fictional map or sample-location fallback. The app does not claim precise camera pose, continuous indoor position, or spatial AR.

### 2. Architecture

A mobile-first React/TypeScript client connects to an Express server. The client resizes photos and obtains per-image consent. One LLM orchestrator selects official plan pages for detailed inspection and returns typed region hypotheses. The server validates tool arguments, source IDs, completion status and region bounds. A two-stage workflow, 60-second deadline, bounded retries, shared request budgets and transactional rollback limit inference. Only user confirmation selects a proposed region; walking routes are unavailable.

The server-side adapter uses a configured Gemini model and can fall through to an ordered list of Gemini models on quota, service, timeout or invalid-model failures. New installs default to Gemini 2.5 Flash-Lite with Gemini 2.5 Flash as fallback; Google's current pricing page lists both with free-tier input/output. Existing private model settings are preserved. The actual account's free-tier eligibility and quota must still be checked. Earlier photo checks encountered overload, timeouts, response limits and quota errors; successful visual localization remains unverified. Missing configuration gives setup guidance. Source plans stay behind the scenes and appear only with relevant location results.

### 3. Core components and current scope

The mobile-first MVP includes photo upload/native capture, per-photo consent, visual comparison, one region overlay with relevant source links, internal source records and transient session state. Clearing analysis removes the current result. No live camera stream or automatic location tracking is used. No provider error can produce a substitute sample location.

The source pipeline downloaded 89 Burnaby floor plans across 45 buildings and one campus map from official BCIT pages [1,2]. It records URLs, retrieval times, hashes, attribution, and page references. All 89 plans now have full PNGs, overviews, four detail crops, and geometry JSON. Eight overview sheets support visual shortlisting. The 566,620 extracted drawing primitives remain unclassified; they are not verified walls, doors, rooms or walking edges. Original PDFs remain unmodified.

Real-campus routes remain unsupported pending source review and field checks. The user explicitly removed the earlier synthetic fallback, including mode controls, fictional landmarks, routing, simulated closures and browser OCR. No custom training is required: source preprocessing, visual retrieval and pretrained LLM interpretation are separate operations. Raw drawing paths are not automatically promoted to navigable links.

---page---

### 4. Implementation challenges and controls

**Reliable visual localization.** A photograph and a top-down plan have different viewpoints; repeated corridors may not be distinguishable from one image. Coarse shortlisting can omit the correct plan. Extracted paths include text and symbols, and their architectural meaning remains unreviewed. Proposed regions therefore require confirmation. Scale, floor alignment, real routes and accessibility need source review and field checks.

**Incomplete responses and uncertainty.** An HTTP-success response may still end before producing an answer. The adapter checks completion status and rejects partial tool calls, unknown IDs and invalid coordinates. Low thinking and bounded output allowances leave room for structured results. Ambiguous scenes lead to clarification; a confirmed hypothesis remains unverified.

**Provider and device limits.** Visual shortlisting and a public source-image cache reduce repeated work. Free-tier quotas depend on the API project and must be checked in AI Studio [5]. Timeouts and quota errors show retry guidance; no substitute result is fabricated. Real phone capture, HTTPS setup, Safari, battery impact and on-campus use remain untested [6].

### Evaluation and delivery plan

Completed work includes the local app, official source import and conversion, multimodal adapter, unit/API regression tests and desktop/mobile browser automation with mocked responses. Tests cover actual inline image transport, consent, source scope, coordinate validation, rollback, idempotency, stale responses, legacy-action rejection and provider failures. The latest code checks pass; further screen checks were skipped at the user's request. Mocked results do not establish campus accuracy.

Next milestones are original-assignment reconciliation, a successful live photo walkthrough, representative campus-photo evaluation, physical phone checks and verified topology before adding navigation. Evaluation should measure shortlist recall, region errors, abstention and latency using reviewed ground truth. The team will assign data, interface, agent/testing and review owners using the member placeholders. A project walkthrough and requirements checklist accompany the app.

### Governance and ethics

Photos are resized locally and sent transiently to Google only after per-photo consent; no media is saved in application storage. Provider free-tier data handling requires disclosure. Retrieved PDFs, images, and text are untrusted evidence, never instructions. Action logs show tools and sources, not hidden reasoning. Accessibility and travel-time precision are not asserted without evidence. Original BCIT files retain attribution and usage restrictions [1,7]. The prototype is not for emergency routing.

### Assignment record and references

Per the supplied brief: proposal due **October 21, 2026, 23:59 (timezone unspecified)**; in-class presentation **October 22, 2026**; one submission per group, no late work; filename **proposal_groupnumber.pdf**. Replace group/member placeholders. The proposal is non-binding. The separately referenced assignment PDF was not provided and must be checked before submission. Nothing has been submitted or published.

[1] BCIT, Floor Plans. https://www.bcit.ca/facilities/campus-maps/floor-plans/
[2] BCIT, Campus Maps & Wayfinding. https://www.bcit.ca/facilities/campus-maps/
[3] Google, Gemini 3.6 Flash. https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
[4] Google, Gemini API pricing. https://ai.google.dev/gemini-api/docs/pricing
[5] Google, Rate limits. https://ai.google.dev/gemini-api/docs/rate-limits
[6] MDN, getUserMedia. https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
[7] BCIT, Copyright. https://www.bcit.ca/copyright/

Sources checked October 15, 2026. Detailed implementation and measurement evidence are in the accompanying project documentation.
