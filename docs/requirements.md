# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. The user's latest direction explicitly removes Demo mode and its fictional fallback. The separately referenced assignment PDF is absent, so assignment compliance must still be checked against that document.

| Requirement                            | Current implementation/evidence                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Burnaby-only official sources          | 89 floor plans / 45 buildings plus campus map; manifest, hashes and source links                                                    |
| PDF conversion                         | Full PNGs, overviews, overlapping crops, atlas and geometry JSON for every floor plan                                               |
| Actual-photo interpretation            | Both API stages send the context image and four crops from the original photo; plan comparison remains visual and source-grounded   |
| LLM agent and tools                    | One orchestrator shortlists supplied plans, eliminates conflicts, and returns only its best supported hypothesis or abstains        |
| Free-tier provider and server-side key | `server/provider.ts`, `.env.example`, [provider record](provider.md)                                                                |
| Location uncertainty                   | One clearly labeled unverified location estimate; users are not asked to confirm a location they may not recognize                  |
| Mobile photo/camera input              | Local resizing, photo picker and native camera capture                                                                              |
| Privacy and governance                 | Per-photo consent; transient media/session state; untrusted source evidence; no hidden reasoning logs                               |
| Failure behavior                       | Setup, timeout, overload, quota, blocked and incomplete-response errors; no synthetic fallback                                      |
| Source plans behind the scenes         | Full official dataset remains available to Gemini; only relevant plan images and original-source links appear with location results |
| Destination input and routing          | Typed or browser speech input; exact source-label room lookup and visual outdoor pilot route to mapped building vicinity only       |
| Indoor routing, closures, ETAs         | Unsupported pending authoritative indoor connections, verified entrances, current conditions, route measurements, and field review  |
| Verification/evaluation                | Mocked unit/API/browser checks and source hashes; live successful localization and field accuracy remain unverified                 |
| Documentation/proposal                 | README, architecture/data/provider/operations/verification notes, walkthrough and two-page proposal                                 |

Old mode preferences are cleared and mode/fixture/replay/simulation/destination/checkpoint actions are rejected. Tests explicitly verify that legacy requests cannot restore the removed functionality.

The limited outdoor pilot is grounded in the pedestrian paths identified on BCIT's campus wayfinding map and is clearly labeled as not field-verified. An exact building-code match from the photo estimate seeds its approximate map-side vicinity as the route start; no precise photo-to-map position is claimed. The client draws normalized route polylines over a hash-verified crop of the official map. Typed room destinations use exact source-label lookup and, when connected, route only to the approximate building vicinity; no indoor route or room-level arrival is claimed. Routes are chosen by fewest map-linked segments, not distance; sentence-based instructions and AR are not implemented. Extending to operational outdoor or indoor navigation requires field-validated corridors, entrances, transitions, cost assumptions and accessibility evidence. Removing the demo is not evidence of physical navigation accuracy.
