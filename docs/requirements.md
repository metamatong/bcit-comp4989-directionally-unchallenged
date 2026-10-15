# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. The user's latest direction explicitly removes Demo mode and its fictional fallback. The separately referenced assignment PDF is absent, so assignment compliance must still be checked against that document.

| Requirement | Current implementation/evidence |
|---|---|
| Burnaby-only official sources | 89 floor plans / 45 buildings plus campus map; manifest, hashes and source links |
| PDF conversion | Full PNGs, overviews, overlapping crops, atlas and geometry JSON for every floor plan |
| Actual-photo interpretation | `server/photo-localization.ts` sends the actual consented photo in both Gemini stages |
| LLM agent and tools | One orchestrator shortlists supplied plans, inspects details and returns validated hypotheses or abstains |
| Free-tier provider and server-side key | `server/provider.ts`, `.env.example`, [provider record](provider.md) |
| User confirmation and uncertainty | Candidate regions, observable matches, limitations, source links and explicit confirmation |
| Mobile photo/camera input | Local resizing, file capture, rear-camera preview and upload on permission denial |
| Privacy and governance | Per-photo consent; transient media/session state; untrusted source evidence; no hidden reasoning logs |
| Failure behavior | Setup, timeout, overload, quota, blocked and incomplete-response errors; no synthetic fallback |
| Source search without inference | Official catalogue/text search and downloadable original/source-derived assets |
| Destination routing, closures, ETAs | Removed with synthetic routes; unavailable pending verified campus topology |
| Verification/evaluation | Mocked unit/API/browser checks and source hashes; live successful localization and field accuracy remain unverified |
| Documentation/proposal | README, architecture/data/provider/operations/verification notes, walkthrough and two-page proposal |

Old mode preferences are cleared and mode/fixture/replay/simulation/destination/checkpoint actions are rejected. Tests explicitly verify that legacy requests cannot restore the removed functionality.

Future routing requires source-reviewed and field-validated corridors, entrances, transitions, cost assumptions and accessibility evidence. The empty real-campus graph/landmark placeholders do not enable routes. Removing the demo is not evidence that real navigation has been implemented.
