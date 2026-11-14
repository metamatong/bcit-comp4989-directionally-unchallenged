# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. The user's latest direction explicitly removes Demo mode and its fictional fallback. The separately referenced assignment PDF is absent, so assignment compliance must still be checked against that document.

| Requirement | Current implementation/evidence |
|---|---|
| Burnaby-only official sources | 89 floor plans / 45 buildings plus campus map; manifest, hashes and source links |
| PDF conversion | Full PNGs, overviews, overlapping crops, atlas and geometry JSON for every floor plan |
| Actual-photo interpretation | Both API stages send the context image and four crops from the original photo; plan comparison remains visual and source-grounded |
| LLM agent and tools | One orchestrator shortlists supplied plans, eliminates conflicts, and returns only its best supported hypothesis or abstains |
| Free-tier provider and server-side key | `server/provider.ts`, `.env.example`, [provider record](provider.md) |
| User confirmation and uncertainty | One unverified location estimate, observable evidence, source links and explicit confirmation |
| Mobile photo/camera input | Local resizing, photo picker and native camera capture |
| Privacy and governance | Per-photo consent; transient media/session state; untrusted source evidence; no hidden reasoning logs |
| Failure behavior | Setup, timeout, overload, quota, blocked and incomplete-response errors; no synthetic fallback |
| Source plans behind the scenes | Wayfinding photo requests use only the 12 pilot plans. The UI shows relevant source images with results and directions. |
| Destination routing, closures, ETAs | Reviewed pilot paths with per-floor arrows, directional crossings and explicit gaps. Live closures and ETAs are unavailable. |
| Internal topology authoring | Local-only editor for 12 SE12/SW3/SW1 plans, manual point/connection placement, evidence, review history and persistent JSON |
| Candidate confirmation | Separate source-grounded A/B proposals; T/F/unknown and explicit permitted direction; source-bound response history; user confirmation is distinct from physical field validation |
| Reviewed-graph route checks | Internal deterministic edge-count/measured-distance queries; excludes drafts, rejected/stale records and invalid endpoints; uses revisioned topology |
| Verification/evaluation | Mocked unit/API/browser checks and source hashes; live successful localization and field accuracy remain unverified |
| Documentation/proposal | README, architecture/data/provider/operations/verification notes, walkthrough and two-page proposal |

Old mode preferences are cleared and mode/fixture/replay/simulation/destination/checkpoint actions are rejected. Tests explicitly verify that legacy requests cannot restore the removed functionality.

Visitor routing requires a confirmed photo region, an explicitly selected checkpoint and a reachable reviewed destination. The editor stores current approvals in `topology.json`. Four traced corridors can be drawn on source pages. User reports supply connectivity evidence. Independent field validation, measured costs and accessibility evidence remain outstanding.
