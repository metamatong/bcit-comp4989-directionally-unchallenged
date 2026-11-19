# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. Current product direction is GPS-by-default photo localization with automatic start selection, no visitor start confirmation, guided route steps, automatically derived within-building transfers, and fixed developer-maintained cross-building links.

| Requirement | Current state |
|---|---|
| Official Burnaby plans | 89 floor plans across 45 building IDs are catalogued. |
| Photo localization | One configured provider stage extracts labels/features; source lookup automatically ranks matches. |
| Required GPS | **Get Directions** requests GPS by default. The browser keeps raw coordinates and sends derived building candidates. |
| Starting place | The strongest source-linked photo/GPS building match is selected automatically; there is no start chooser in the visitor app/API. |
| Floor GPS dot | Building footprints are available for SE12, SW03, SW05 and SW01. Fourteen plans have approximate alignments: all floors of SE12, SW01 and SW03, and SW05 floors 1–2. The remaining 75 supplied plans are unaligned. |
| Route display | Route overview with floor maps, followed by one current step per guided page. GPS does not identify floors or advance steps. |
| Same-building transfers | Still use legacy hand-authored records in the published graph. Automatic inference from stacked floor plans is an outstanding implementation gap. |
| Cross-building transfers | Fixed mapped records; this is the only connection type intended to require developer-maintained links. |
| Accessibility preference | Stairs are preferred by default; the checkbox prefers elevators. A fallback route can still include stairs when no complete elevator path is mapped. |
| Privacy | Photo bytes are transient; raw GPS coordinates stay in browser memory. |
| Field accuracy | Photo starts, floor-plan alignments and indoor GPS accuracy have not been generally measured on campus. |

The main source-data limits are described in [floor routing](floor-routing.md), [photo localization](photo-localization.md) and [device location](device-location.md). The latest verification record is in [verification.md](verification.md). The separately referenced assignment PDF was not supplied, so assignment compliance still needs to be checked against that document.
