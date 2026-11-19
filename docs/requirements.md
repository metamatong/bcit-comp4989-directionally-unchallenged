# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. The user's latest direction covers all supplied Burnaby floor plans and uses a single photo evidence stage. Exact matches can proceed automatically and ambiguous places can be selected. The separately referenced assignment PDF is absent, so assignment compliance must still be checked against that document.

| Requirement | Current implementation/evidence |
|---|---|
| Burnaby-only official sources | 89 floor plans / 45 buildings plus campus map; manifest, hashes and source links |
| PDF conversion | Full PNGs, overviews, overlapping crops, atlas and geometry JSON for every floor plan |
| Actual-photo interpretation | One provider stage extracts labels and structured visible features. Subsequent metadata-only lookup uses those fields and opted-in GPS building candidates. |
| LLM agent and tools | One extraction call followed by exact source retrieval and reviewed-graph route calculation. Repeated and partial sign matches are offered for selection. A building-only GPS result asks for a readable sign. |
| Free-tier provider and server-side key | `server/provider.ts`, `.env.example`, [provider record](provider.md) |
| Photo start and uncertainty | Automatically selects a unique place or offers individual source occurrences and numbered doorway choices. |
| Mobile photo/camera input | Local resizing, photo picker and native camera capture |
| Device-assisted walking | Optional foreground position tracking in walking directions. Photo start acquisition can also use an opted-in device reading for building matches. SE12 floor 3 has an approximate floor alignment. [Coverage and validation](device-location.md) |
| Privacy and governance | Per-photo consent; transient media/session state; untrusted source evidence; no hidden reasoning logs |
| Failure behavior | Setup, timeout, overload, quota, blocked and incomplete-response errors; no synthetic fallback |
| Source plans behind the scenes | Place lookup covers the 89 supplied floor plans. The UI shows relevant source images with results and directions. |
| Destination routing, closures, ETAs | The visitor planner searches precomputed floor graphs and reviewed transfers. Cross-building travel is constrained to mapped building connections. Live closures and ETAs are unavailable. |
| Internal topology authoring | Local-only editor for all supplied plans, manual point/connection placement, evidence, review history and persistent JSON |
| Candidate confirmation | Separate source-grounded A/B proposals; T/F/unknown and explicit permitted direction; source-bound response history; user confirmation is distinct from physical field validation |
| Reviewed-graph route checks | Deterministic graph checks and complete reviewed visitor routes. Excludes drafts, rejected/stale records and invalid endpoints. Visitor search uses drawing-grid and transfer costs. |
| Verification/evaluation | Mocked unit/API/browser checks and source hashes; live successful localization and field accuracy remain unverified |
| Documentation/proposal | README, architecture/data/provider/operations/verification notes, walkthrough and two-page proposal |

Old mode preferences are cleared and mode/fixture/replay/simulation/destination/checkpoint actions are rejected. Tests explicitly verify that legacy requests cannot restore the removed functionality.

The [floor compiler and coverage report](floor-routing.md) describe searchable campus places, walkable approaches and missing transfers. The visitor route follows a continuous path in the combined graph. The published interbuilding transfers connect SE12 to SW03 and SW03 to SW01. The four SW03–SW01 crossings serve the same floor in both directions. Within SW01 the reviewed stairs and elevators connect the marked landings. Staff-only room 1494 and the marked internal passage through 1498 are excluded from visitor directions. A visitor can also select a source-checked walking cell on an identified floor. [SW01 implementation and remaining gaps](sw01-routing.md)
