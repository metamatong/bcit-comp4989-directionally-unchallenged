# Internal topology editor

The local editor at `/internal/topology` lets a human confirm proposed connections on 12 official SE12, SW03 and SW01 floor plans, correct markers, manually annotate additional passages and check routes over reviewed records.

## Answer-first workflow

The default **후보 확인 · T / F** view selects the first unanswered question. Compare the A and B regions on their original plans and review whether the indicated passage connects the two points.

Enter a reviewer name or nickname once for the current editor session. If both markers are right, answer T/F/unknown. T confirms the displayed endpoints and their proposed connection; a separate direction question offers both ways, A→B only, B→A only, or unknown, without a preselected choice. T plus a known direction atomically creates/updates and approves the two points and that allowed edge. Unknown direction records T but excludes the passage from routing. F rejects the presented candidate only; unknown defers it. Neither is evidence that no other route exists between the buildings.

Use **A/B 위치·층 수정** to correct a marker or its floor before answering. Markers remain page-relative when viewing a cropped region. A floor change clears the previous point because page coordinates cannot be transferred across floors; click the actual point on the new page or use explicit numerical entry. Corrected proposals are saved with the answer even if the answer is F or unknown. Source PDFs and rasters are never modified.

The answer stores the reviewer, server timestamp, exact endpoint snapshots, source hashes, proposal/presentation hashes, optional note and the separate direction answer. It is **user-confirmation** evidence with no automatically populated field-observation date. It does not assert a new campus visit, current opening hours, accessibility or measured distance. Existing measured costs survive re-confirmation only if their passage and endpoints remain unchanged and the previous edge is still eligible; unapproved or changed measurements are discarded rather than silently approved through a T answer.

Answers are append-only within the graph document. Changing a prior T to F/unknown/unknown direction withdraws the generated connection from routing. Re-answering uses the same generated records when they still exist, avoiding duplicate graph nodes/edges. Manual point changes invalidate approvals and appear in the next question for explicit re-confirmation. Stale graph revisions, proposal presentations and source hashes are rejected. The existing point/connection editor remains available under **직접 수정 · 경로 확인**; approved candidates offer **이 연결의 경로 확인** with the direction-appropriate endpoints selected.

To extend the question set, inspect the original plans and add versioned definitions to `data/campus/connection-candidates.json`. Each definition references the source hash for each endpoint and explains how to identify it on the page. Restart the server after changing the catalogue and run data validation.

## Stairs and elevators between floors 2 and 3

A marks floor 2 and B marks floor 3 on each original proposal. Review one facility and select the direction it serves. The positions were read independently on the four PDFs.

| Building | Stairs, floor 2 ↔ floor 3 | Elevator review |
|---|---|---|
| SE12 | S209 ↔ S327 by corridor 208Z and room 327, S200 ↔ S300 by the dining wing, S202 ↔ S313 by 201T and 313Z, S228 ↔ S328 by 213H and 341A | The plans leave both boarding locations uncertain. A separate question records whether a reviewer knows of a lift serving both floors. |
| SW03 | S260 ↔ S360 at the SE12 end of the main wing, S270 ↔ S370 by lounges 2704 and 3704, S280 ↔ S380 at the other end of the main corridor | The campus map places an E near the SE12 end of SW03. Each floor plan shows a corridor-facing shaft opening beside the stair doors in that area. The proposed waiting points face 2696 and 3696. Check the two doors and whether this lift serves both floors. [BCIT Burnaby Accessibility Map](https://www.bcit.ca/files/maps/pdf/bby_access_map.pdf) |

For the SE12 elevator inquiry, T records a report that the elevator serves both floors. F and unknown are also available. Each floor report keeps the reviewer, time, source and presentation hashes, floor references and any position actually entered. Missing coordinates stay null. To add the connection to routing, mark both elevator doors, confirm their correspondence and select a permitted direction.

The short steps between the SW03 lounge and hall, SE12 S203 marked “down” on floor 2, and SW03 S299 in the annex lack a matching full floor 2–3 connection on these sheets. Operational status, accessibility and travel distance need their own evidence.

## First continuous route

Two SW03 questions connect the doors and lift stops that have already been reviewed. On floor 2, check whether the entrance by 2063/2080 leads through corridors 2000 and 2600 to the boarding point by 2696. On floor 3, check whether the boarding point by 3696 leads through corridors 3600 and 3000 to the SE12 passage by 3081/3086. Compare both points on the same plan, confirm the whole passage and select the permitted direction.

When both corridors support the proposed journey, open **직접 수정 · 경로 확인 → Route check** and choose the SE12 floor 2 exterior doorway and the SE12 floor 3 SW03 passage as endpoints. With travel permitted in the forward directions, the recorded path has five connections: the outdoor passage, the SW03 floor 2 corridor, the SW03 elevator, the SW03 floor 3 corridor and the building link. Use **Fewest recorded connections** while distances are unknown.

Each corridor definition references the candidate and side that own each endpoint. On approval, the server uses the exact reviewed node IDs and current versions. To correct a shared point, edit its owner, review the point and recheck affected connections. Withdrawing a corridor removes that passage from routing and preserves the preceding door and lift reviews.

## Recorded floor correction — November 13, 2026

The user clarified that SE12 floor 2 connects to SW03 floor 2, and SE12 floor 3 connects to SW03 floor 3. The second-floor journey exits one building, travels outdoors and enters the other. The user also reported that part of SE12 floor 2 meets the ground. Keep its official floor label `2`; do not rename it floor 1, assign a global elevation, assume every floor-2 door reaches ground, or infer step-free access.

The original fourth-floor T answers remain in history and the linked points and connection are in draft. The user subsequently confirmed the two second-floor exterior doorways and bidirectional outdoor travel. This and the third-floor building link are the two eligible connections at graph revision 7. Intermediate geometry, grade and distance are unknown.

## Who enters the first data?

For the prepared pairs, the assistant supplies source-grounded candidates and the user supplies the connection/direction answers. For passages outside that initial set, the person inspecting the plans can still enter them manually under **직접 수정 · 경로 확인**. Start with a short passage you can check, then extend it. Add a point at each doorway, corridor junction, stair landing, elevator stop or checkpoint needed by the route. Use exact room identifiers when applicable and descriptive names for otherwise unnamed portals. Do not use a room label's text box as a doorway without checking the drawing.

Save a point as draft with its evidence. A source-plan ID, original PDF hash and normalized coordinates are attached automatically. Add separate points on each actual arrival floor; floor numbers in different buildings do not imply equal elevation. Points use page-relative X/Y percentages with a top-left origin. Zoom changes only the display. Keyboard users can focus the plan in placement mode, press Enter to begin at the page centre and edit X/Y to the intended position.

In Connections, select the two endpoints from the complete saved-point list or use Pick from/Pick to on plan. Switch the plan selector to pick another floor or building. Corridor edges stay on one plan. Stair/elevator edges join the corresponding point types on different floors of the same building. Building links explicitly join two buildings and may join different floor numbers. Outdoor edges join exterior doorways and require dated field evidence or explicit user confirmation of the complete passage before approval. A plan-only review of an exterior doorway does not establish a complete outdoor route.

Record one-way versus two-way passage explicitly; the initial two-way choice must be checked before approval. Enter the passage evidence, observed date for field observations, and notes about any restrictions. Record the complete passage, not just visible adjacency. Add intervening junctions when needed; no same-floor or same-stair-name edges are generated. Each elevator pair must be explicitly recorded; the app does not assume service to other floors. Current source extraction gaps do not prevent manual annotation, but the editor does not repair OCR or invent labels.

## Review and route eligibility

1. Save point and connection drafts.
2. Review each endpoint's placement, label and source, with a reviewer name and decision note.
3. Review the connection's full passage, actual arrival floor and allowed direction. Approve only after checking its evidence.
4. Run Route check with approved start and destination points.

Plan review, user confirmation, field observation and combined plan/field evidence are distinct. An approval is a human attestation, not an independently verified position, an accessibility assessment, or proof of current opening conditions. Reviewer names are self-entered; there are no authenticated staff identities in this local prototype.

Each approval includes its date, reviewer, decision note, record version, a hash of the exact reviewed content and an evidence snapshot. Records retain review history. Editing a point returns it and incident connections to draft. Withdrawing a point approval also invalidates incident connection approvals. Editing a connection clears its current approval. Original-source changes, altered reviewed content and stale endpoint versions exclude affected records from routes. Saving a point against a refreshed official source attaches the current hash and requires a new review.

Approved records alone are not enough: both endpoints must also be approved, current, and source-linked. The server enforces this on every route request, independent of the browser. Missing routes return an explicit no-route result; neither Gemini nor label proximity fills gaps. Photo evidence and topology are separate: selecting an AI region does not create a graph point, connection or route start.

## What the route check means

- **Fewest recorded connections:** minimizes edge count in the approved graph. It depends on graph segmentation and does not establish a shortest walking distance.
- **Shortest recorded distance:** Dijkstra over approved edges with positive entered distances and measurement evidence. Edges with unknown distance are excluded, never given a default metric cost. This finds a minimum within the recorded, measured subgraph only; unmeasured alternatives may be shorter.

Routes return ordered point/edge IDs, the graph revision and connection evidence. Selecting a route point displays its plan. Lines between markers are schematic relationships, not surveyed corridor polylines; links between different plans are shown in the route list rather than projected across unrelated page coordinates. No ETA, camera heading, accessibility, live closure, elevator availability or continuous position claim is made.

## Storage, backup and conflicts

`data/campus/topology.json` contains `schemaVersion`, a monotonic `revision`, `updatedAt`, `nodes`, `edges`, `candidateAnswers` and `floorObservations`. Earlier documents read missing collections as empty lists. The next explicit edit persists the document. Exports include marked-point answers as well as floor reports. The source definitions live in `connection-candidates.json`.

On first use in a fresh checkout, the server initializes the local file from `spatial/reviewed-network.json`. Imported records cite their published approval hashes. The displayed import timestamp and attribution describe the local import. Only the eligible points and passages, their source-bound candidate references and the published elevator report are included. Full review history, draft records and free-text notes remain in the originating workstation's backup. A pre-existing file is used as-is. Restore a backup before starting the app when recovering lost local work.

Each mutation acquires an exclusive `.lock` file, reads the latest document, checks the expected revision and writes a temporary file before atomic rename. A stale tab gets HTTP 409 without overwriting the newer file. Copy important unsaved text or explicitly discard it, then Reload. An uncertain response should also be followed by Reload before retrying. An existing invalid file or the disappearance of an open file raises a storage error.

Export saved graph downloads a JSON backup of the last loaded, saved revision. Unsaved edits are excluded. Deleting a point also deletes its incident connections and their histories; deleting a connection removes that record and its history. The UI asks for confirmation. Export before destructive changes.

To restore: stop the local server, copy a valid exported document over `data/campus/topology.json`, run `npm run data:validate`, then restart. Do not edit the file while the server is running. If a crash leaves `data/campus/topology.json.lock`, first stop all editor server processes, make a backup, then remove only that lock and retry. Temporary files and locks are ignored by Git. Keep one running server per topology file. The file write strategy protects against ordinary partial writes and concurrent editors; it is not a database with a power-loss durability guarantee.

## Internal access and API

The editor page and its API require an actual loopback connection and a local Host header. Forwarded headers do not grant access. Cross-site requests are rejected; the application also checks API Origin. Raw topology JSON, lock and temporary-file requests are blocked before the development/static fallback, including filesystem-style URLs. It works without Gemini configuration. It cannot be opened from another phone or computer on the LAN. Campus checks can be recorded on the local workstation after the walk; a remote staff workflow would require separate authentication and access design.

- `GET /api/internal/topology`: pilot plan metadata, saved document, routing eligibility and source-bound candidate presentations with current answer state.
- `POST /api/internal/topology/edits` accepts `{ revision, command }`. Use `answer-candidate` for two marked points and `record-floor-observation` for a floor inquiry with one or both elevator positions unknown. The server checks the revision, presentation and original source hashes for both operations. The manual editor also uses `save-node`, `save-edge`, `delete-node`, `delete-edge` and `review`.
- `POST /api/internal/topology/route`: `{ revision, fromNodeId, toNodeId, mode }`. The server reloads the document and computes only over eligible records.

`src/topology.ts` defines the shared types/schemas. `server/topology.ts` owns storage, source binding, review and eligibility; `server/routing.ts` owns deterministic routing; `server/topology-api.ts` owns internal access and API handling. The visitor bootstrap and photo sessions do not expose the editable graph. The local visitor planner reads current approvals from the same store. Withdrawing a room approach also withdraws its corridor overlay from subsequent route requests.

## SE12 room 302 to SW03 office 2082

Two source-bound questions complete the ends of the indoor itinerary through the third-floor connecting passage and SW03 east elevator. Both have user-confirmed bidirectional answers in revision 28.

- **SE12 floor 3**. A is the drawn threshold of classroom 302 on the window-side corridor. Follow the frontage of 306, 308, 310 and 312 to 312A, then turn into the narrow SW03 passage to B, its existing reviewed junction. [Review this segment](http://127.0.0.1:3000/internal/topology?candidate=se12-f3-302-to-sw03-link)
- **SW03 floor 2**. A is the interior side of the existing exterior doorway between rooms 2063 and 2080. Follow corridor 2000 into the building to B, the corridor-side threshold of office 2082 between office 2081 and meeting room 2083. This question covers indoor travel only. [Review this segment](http://127.0.0.1:3000/internal/topology?candidate=sw3-f2-exterior-door-to-2082)

The combined view displays both pins and the proposed bends on one source page. Expand the endpoint details to inspect or adjust an editable pin. The proposed bends and room-door references are included in the candidate definition hash. A current T and its permitted direction can activate the trace only while its endpoints and source still match. Changing an endpoint disables its original trace until the source line is revised and reviewed.

## Classroom approaches

Two additional SW03 corridor questions share a previously approved east elevator landing. Each has a new room-door point. Floor 2 uses the 2605 door opposite vestibule 2604, and floor 3 uses the 3615 door opposite vestibule 3604. The user confirmed both directions in chat. Those answers are stored at revisions 24 and 25 with user-confirmation evidence, no field date, and the hash of the approved edge. The alternate door to 2605 has no approved approach.

## Validation scope

Regression fixtures use artificial annotations in temporary files and mocked providers; they are not campus connection evidence. Tests cover persistence, review/evidence gates, edits invalidating approvals, stale hashes/content/endpoints, record deletion, conflicts/locks, invalid input, route objectives, directed edges and loopback access. Node-rendered component tests check form contracts. Browser, screenshot, physical-device and campus checks remain separate and are not performed under the existing no-screen-check preference.
