# CampusLens

## An evidence-first campus wayfinding agent

**COMP 4989 | Group [NUMBER] | Members [NAMES / STUDENT IDS]**
**Proposal draft | October 16, 2026 | Non-binding scope**

### 1. Novel AI agent use case

CampusLens helps students estimate where they are from a photograph on BCIT's Burnaby campus, then find a destination using a visual map. A bounded Gemini workflow reads visible room labels without plan hints, retrieves exact matches from official floor-plan records, and compares the photograph with relevant plans and drawing geometry. It presents one source-linked, unverified estimate or abstains when evidence is ambiguous. The user is not asked to confirm a location they may not recognize.

The user selects **Find my location**, uploads or captures a photo in a popup, consents, and starts analysis. Progress remains in the popup; on completion it closes and the result appears on the main page. The user then types or speaks a destination. An exact mapped-building match seeds an approximate outdoor route start automatically. The app has no demo mode, fictional map, or sample-location fallback, and does not claim precise camera pose, continuous indoor position, or spatial AR.

### 2. Architecture

A React/TypeScript client sends a consented context image and four crops generated from the original to a dedicated photo-label API. Gemini reads visible room identifiers without plan hints. A second API request uses a short-lived evidence ID bound to the same image bundle. The server searches all extracted labels using exact whole-identifier matching, retrieves relevant plans, and asks Gemini for one unverified estimate or abstention. Visual shortlisting remains available when labels are unreadable or ambiguous. Typed validation, deadlines, request budgets, and rollback constrain the workflow. Photos are transient; no confirmation of location accuracy is requested.

The server-side adapter uses configured Gemini models and can try the ordered Gemini fallback list on quota, service, timeout, or invalid-response failures. Verify free-tier eligibility for the actual API project before use; model availability and quotas can change. Missing configuration and provider failures are explicit and never produce a substitute location. Source plans stay behind the scenes and appear only with relevant location results.

### 3. Core components and current scope

The MVP includes photo upload/native capture, original-image detail crops, per-photo consent, separate reading/comparison requests, exact whole-label lookup, a source-linked region overlay, and transient session state. Clearing analysis removes the current result. There is no location-confirmation control, live camera stream, automatic location tracking, or provider-error fallback that produces a substitute location.

The source pipeline downloaded 89 Burnaby floor plans across 45 buildings and one campus map from official BCIT pages [1,2]. It records URLs, retrieval times, hashes, attribution, and page references. All 89 plans now have full PNGs, overviews, four detail crops, and geometry JSON. Eight overview sheets support visual shortlisting. The 566,620 extracted drawing primitives remain unclassified; they are not verified walls, doors, rooms or walking edges. All 5,463 extracted labels are searchable; the older 80-label preview is ignored. Whole identifiers such as 302 and 3021 are distinct. Original PDFs remain unmodified.

The route pilot covers 13 central-campus locations and 14 outdoor segments traced from BCIT's official wayfinding map; it is not field-verified. An exact building match from the photo estimate seeds an approximate mapped vicinity, not a verified position or entrance. Users type or speak destinations; exact source-plan labels can resolve rooms, but routes stop at the mapped building vicinity because indoor paths are unavailable. Directions are a visual map overlay only: no sentence steps, AR, distances, accessibility, live closures, or full-campus coverage.

---page---

### 4. Implementation challenges and controls

**Reliable visual localization.** A photograph and a top-down plan have different viewpoints; repeated corridors may not be distinguishable from one image. Coarse shortlisting can omit the correct plan. Extracted paths include text and symbols, and their architectural meaning remains unreviewed. Estimates therefore remain unverified. Scale, floor alignment, real routes and accessibility need source review and field checks.

**Incomplete responses and uncertainty.** An HTTP-success response may still end before producing an answer. The adapter checks completion status and rejects partial tool calls, unknown IDs, and invalid coordinates. Ambiguous scenes lead to abstention or a request for another photo; every displayed estimate remains unverified.

**Provider, mapping, and device limits.** Gemini quotas depend on the API project and must be checked in AI Studio [5]. Timeouts and quota errors show retry guidance; no substitute result is fabricated. The map network and image overlay are approximate source-derived evidence, not a field-verified navigation service. Exact room lookup does not provide indoor routing. Physical phone capture, Safari behavior, battery impact, and on-campus use remain untested [6].

### Evaluation and delivery plan

Completed work includes the local app, official source import and conversion, multimodal adapter, unit/API regression tests, and desktop/mobile browser automation with mocked responses. Tests cover inline image transport, consent, source scope, exact label lookup, route resolution and map-image delivery, coordinate validation, rollback, idempotency, stale responses, removed-action rejection, and provider failures. The current verification run passes all 130 unit/API tests, the production build, and source-data validation. Browser and manual screen checks were skipped at the user's request. Mocked results do not establish campus localization or route accuracy.

Next milestones are original-assignment reconciliation, a successful live photo walkthrough, representative campus-photo evaluation, physical phone checks, and field review of route geometry. Any future indoor or AR work depends on reliable semantic floor plans, map registration, and camera pose/heading, not a simulated overlay. Evaluation should measure label extraction, localization region errors, abstention, route coverage, and latency against reviewed ground truth. The team will assign data, interface, agent/testing, and review owners using the member placeholders. A project walkthrough and requirements checklist accompany the app.

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

Sources checked October 16, 2026. Detailed implementation and measurement evidence are in the accompanying project documentation.
