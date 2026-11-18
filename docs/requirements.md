# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. The user's latest direction limits the visitor pilot to SE12, SW03 and SW01, removes Demo mode and its fictional fallback, and asks the app to resolve a photo start without visitor confirmation. The separately referenced assignment PDF is absent, so assignment compliance must still be checked against that document.

| Requirement | Current implementation/evidence |
|---|---|
| Burnaby-only official sources | 89 floor plans / 45 buildings plus campus map; manifest, hashes and source links |
| PDF conversion | Full PNGs, overviews, overlapping crops, atlas and geometry JSON for every floor plan |
| Actual-photo interpretation | One provider stage extracts labels and structured visible features. Subsequent metadata-only lookup uses those fields and opted-in GPS building candidates. |
| LLM agent and tools | One extraction call followed by exact source retrieval and reviewed-graph route calculation. Ambiguous location evidence causes abstention. |
| Free-tier provider and server-side key | `server/provider.ts`, `.env.example`, [provider record](provider.md) |
| Photo start and uncertainty | Automatically selects the sole photo-derived starting area and displays “Starting position acquired” before route planning. The visitor does not select a checkpoint. |
| Mobile photo/camera input | Local resizing, photo picker and native camera capture |
| Device-assisted walking | Optional foreground position tracking in walking directions. Photo start acquisition uses the submitted photo and does not request device location. SE12 floor 3 alignment is approximate. Eleven floor calibrations remain unresolved. [Coverage and validation](device-location.md) |
| Privacy and governance | Per-photo consent; transient media/session state; untrusted source evidence; no hidden reasoning logs |
| Failure behavior | Setup, timeout, overload, quota, blocked and incomplete-response errors; no synthetic fallback |
| Source plans behind the scenes | Wayfinding photo requests use only the 12 pilot plans. The UI shows relevant source images with results and directions. |
| Destination routing, closures, ETAs | AI generates room-to-room paths from official floor plans. Cross-building travel is constrained to mapped building connections. Live closures and ETAs are unavailable. |
| Internal topology authoring | Local-only editor for 12 SE12/SW3/SW1 plans, manual point/connection placement, evidence, review history and persistent JSON |
| Candidate confirmation | Separate source-grounded A/B proposals; T/F/unknown and explicit permitted direction; source-bound response history; user confirmation is distinct from physical field validation |
| Reviewed-graph route checks | Deterministic graph checks and complete reviewed visitor routes. Excludes drafts, rejected/stale records and invalid endpoints. Visitor paths minimize recorded connection count. |
| Verification/evaluation | Mocked unit/API/browser checks and source hashes; live successful localization and field accuracy remain unverified |
| Documentation/proposal | README, architecture/data/provider/operations/verification notes, walkthrough and two-page proposal |

Old mode preferences are cleared and mode/fixture/replay/simulation/destination/checkpoint actions are rejected. Tests explicitly verify that legacy requests cannot restore the removed functionality.

Visitor routing is scoped to SE12, SW03 and SW01. Photo localization selects its single hypothesis automatically; the configured AI provider finds the route endpoints and within-building paths from the official plans. Visitors do not approve rooms, doors, or corridors. Cross-building legs may use only connections mapped in `topology.json`; the current mapped SE12–SW03 links are available to the planner. The default result shows every floor in walking order and labels each transfer. Independent field validation, measured costs and accessibility evidence remain outstanding.
