# Current requirements and evidence

The supplied original [brief](project-brief.txt) remains unchanged. Current product direction is GPS-required photo localization with automatic start selection, no visitor start confirmation, guided route steps, automatically inferred same-building transfers, and fixed reviewed connections between buildings. The visitor app is limited to SE12, SW03, SW05 and SW01 even though the source archive is larger.

| Requirement | Current state |
|---|---|
| Official Burnaby plans | All 89 supplied plans remain archived; the visitor app exposes only the four pilot buildings. |
| Photo localization | One configured provider stage extracts labels/features; source lookup automatically ranks matches. |
| Required GPS | **Get Directions** requests GPS by default. The browser keeps raw coordinates and sends derived building candidates. |
| Starting place | The strongest source-linked photo/GPS building match is selected automatically; there is no start chooser in the visitor app/API. |
| Floor GPS dot | Building footprints cover 43 of 45 supplied buildings. The device overlay has an approximate alignment on 65 of 89 floor plans. The remaining 24 have documented source gaps. Indoor phone accuracy remains unmeasured. |
| Route display | A complete walking route opens on the first guided step. The visitor advances manually and can open the overview for floor maps in travel order. |
| Same-building transfers | Inferred at runtime from source-plan landing labels and positions in SE12, SW03 and SW01. SW05 route integration is handled separately. |
| Cross-building transfers | Fixed reviewed records; this is the only connection type intended to require manual review. |
| Partial route | When the complete path is unavailable, show the reachable route portion, last mapped stop and requested destination marker where possible. |
| Accessibility preference | Stairs are preferred by default; the checkbox prefers elevators. A fallback route can still include stairs when no complete elevator path is mapped. |
| Privacy | Photo bytes are transient; raw GPS coordinates stay in browser memory. |
| Field accuracy | Photo starts, floor-plan alignments and indoor GPS accuracy have not been generally measured on campus. |

The main source-data limits are described in [floor routing](floor-routing.md), [photo localization](photo-localization.md) and [device location](device-location.md). The latest verification record is in [verification.md](verification.md). The separately referenced assignment PDF was not supplied, so assignment compliance still needs to be checked against that document.
