# Device location and walking

GPS is required when a visitor taps **Get Directions**. The browser requests a fresh location reading immediately from that tap, before photo processing. If photo processing takes long enough for the reading to age, the app refreshes it before matching. On the device, the app intersects its reported accuracy area with the official campus building footprints. Both extraction and metadata-only location requests send matching building IDs, accuracy, capture time and source hash; raw coordinates stay in browser memory. Only matching building IDs are forwarded to the photo provider as context, never raw coordinates or reading metadata. If the browser cannot provide GPS, the route request stops with an error.

The app combines that building match with the photo labels and automatically selects the strongest source-linked starting estimate. GPS narrows the building; it cannot identify the floor. The photo evidence identifies the floor and nearby place. Visitors are not asked to choose a starting room or doorway.

## Guided directions

A complete walking route opens on its first step and starts a foreground GPS watch automatically. The step is visible while the watch waits for a fresh reading. The route step selects the floor map, and the visitor advances with the route controls. The position dot and uncertainty area update from fresh GPS readings when the floor has a geographic alignment. Tracking stops when the visitor opens the route overview, finishes, or leaves the page. **Back to steps** returns to the current step and starts a new watch.

For indoor steps on geographically aligned pilot floors, the browser lazily loads that floor's public corridor/lobby walking cells (`GET /api/plans/:planId/walking-surface`, kept separate from the geographic calibration catalogue) and runs client-side corridor map-matching (`src/location/map-matching.ts`):

- Readings with reported horizontal accuracy wider than **35 m** are hidden instead of plotted.
- Eligible indoor readings are constrained to the nearest verified public walkable cell within `min(20 m, max(reportedAccuracy, 12 m))`, using kinematic continuity and a mild, capped tie-breaker toward the active corridor step so sudden noise spikes do not jump across walls while genuine detours into other hallways still appear.
- When a reading is pulled onto a corridor (`≥ 0.5 m` shift), the overlay renders a dashed corridor-matched halo whose radius stays at least as wide as both the reported accuracy and snap distance, and the status line reports the approximate raw offset distance alongside reported accuracy.
- Readings farther than the snap limit from all mapped corridors remain hidden rather than fabricating a match.
- **Outdoor steps** are exempt from indoor corridor snapping and retain standard footprint-overlap and page-bounds checks. When a floor walking surface is unavailable or still loading, the tracker falls back to raw footprint-overlap gating.
- The zoomed step map frames strictly around the route step's markers and path (`src/components/RouteMap.tsx`) so live GPS drift does not jump or zoom out the viewport.

The browser requests high accuracy and zero cached age. A stale or invalid first fix gets one retry within the original 15-second deadline; permission denial and cancellation end acquisition. A reading is eligible only when fresh and valid. The live overlay disappears when readings become stale. Browsers may combine GPS with network signals, and reported accuracy can understate indoor error. Phone use requires HTTPS and location permission; localhost works on the computer running the app. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## Building and floor coverage

The archived BCIT WGS84 layer covers 43 of the 45 supplied buildings. The live dot has an approximate geographic alignment on **65 of 89 floor plans across 33 buildings**. This includes SE12 floors 2–4, SW01 and SW03 floors 1–4, and SW05 floors 1–2. Building footprint, drawing alignment and walking route coverage are measured separately. [BCIT building footprint layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/Bsite_Building_Footprint_20241022/FeatureServer/0)

The [floor-by-floor evidence](../data/campus/geolocation/floor-alignment-evidence.json) records a correspondence or a specific gap for each supplied source PDF. The 24 plans below keep the overlay hidden.

| Area | Floors without geographic alignment |
| --- | --- |
| NE | NE2 floors 1–2, NE3 floors 1–2, NE6 floors 1–2, NE16 floor 1, NE20 floor 2, NE21 floor 1 |
| NW | NW3 floors 1–2, NW4 floors 1–2, NW5 floors 1–2, NW7 floor 1 |
| SE | SE2 floor 1, SE9 floor 1, SE12 floor 1, SE30 floor 1, SE41 floors 1–2 |
| SW | SW9 floors 1–2 |

NE21's future pavilion has an official planning polygon. The archived floor plan depicts the earlier layout, so the pavilion polygon cannot support it. NW7 has a source drawing and historical map references. Its current building polygon remains unconfirmed. The other 22 floors need better correspondences where the source drawings and GIS outlines disagree, the available features cover only part of the floor, or the held-out point exceeds the check limit. [BCIT future footprint layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/CapitalPlan_BuildingFootprint/FeatureServer/3) · [BCIT construction notice](https://www.bcit.ca/facilities/campus-notices/)

## Reproduce the catalogue

For a direct alignment, the evidence records the BCIT polygon vertex and the matching intersection of two floor-plan line segments, or the pixel-read corner converted to PDF page points. For a stacked alignment, it identifies the same stair, shaft or structural corner on two drawings. The source floor must have an active alignment. The target inherits its geographic uncertainty.

The compiler excludes the last correspondence from the fit. It checks that each fitted point differs by at most 1.5 m and the held-out point by at most 2 m. For a stacked alignment, these limits measure the match between drawings at the source floor's scale. The source floor's own GIS error can also affect the target. SE12 floor 3 retains the original four control positions and roughly 1.05 m check. Phone accuracy remains unmeasured across all floors.

```bash
node --import tsx scripts/prepare-geolocation.ts
npm run data:validate
```

Data validation reproduces the visitor catalogue from the archived source references. The earlier `calibration-candidates.json` records are historical drafts. The compiler uses only the reviewed floor evidence and the archived official footprint, and preserves the original PDF, geometry and geographic-source hashes.

## Privacy and remaining gaps

GPS readings stay in active browser memory and are omitted from provider prompts, logs and persistent session state. The app sends only the building candidates derived on-device. Reloading clears readings. The browser and operating system may use their own location service.

On-campus phone walkthroughs are still needed to measure corridor-level error, drift and recovery after stale readings. Guided route progress continues to select the floor during tracking.
