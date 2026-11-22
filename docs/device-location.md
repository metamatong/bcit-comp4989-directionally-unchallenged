# Device location and walking

GPS is required when a visitor taps **Get Directions**. The browser requests a fresh location reading immediately from that tap, before photo processing. If photo processing takes long enough for the reading to age, the app refreshes it before matching. On the device, the app intersects its reported accuracy area with the official campus building footprints. Both extraction and metadata-only location requests send matching building IDs, accuracy, capture time and source hash; raw coordinates stay in browser memory. Only matching building IDs are forwarded to the photo provider as context, never raw coordinates or reading metadata. If the browser cannot provide GPS, the route request stops with an error.

The app combines that building match with the photo labels and automatically selects the strongest source-linked starting estimate. GPS narrows the building; it cannot identify the floor. The photo evidence identifies the floor and nearby place. Visitors are not asked to choose a starting room or doorway.

## Guided directions

A complete walking route opens on its first step and starts a foreground GPS watch automatically. The step is visible while the watch waits for a fresh reading. The route step selects the floor map, and the visitor advances with the route controls. The position dot and uncertainty area update from fresh GPS readings when the floor has a geographic alignment. Tracking pauses when the page is hidden and automatically resets and restarts when the visitor returns (unless location permission was denied or revoked). Tracking stops when the visitor opens the route overview, finishes, or leaves the page. **Back to steps** returns to the current step and starts a new watch.

For same-plan indoor corridor steps on geographically aligned pilot floors, the browser lazily loads that floor's public corridor/lobby walking cells (`GET /api/plans/:planId/walking-surface`, kept separate from the geographic calibration catalogue) and runs client-side corridor map-matching and transient Pedestrian Dead Reckoning (PDR) fusion (`src/location/map-matching.ts`, `src/location/pdr-motion.ts`, `src/location/walkable-grid.ts`, `src/location/pdr-tracker.ts`):

- Readings with reported horizontal accuracy wider than **35 m** are hidden instead of plotted.
- Eligible indoor readings are constrained to the nearest verified public walkable cell within `min(20 m, max(reportedAccuracy, 12 m))`, using kinematic continuity and a mild, capped tie-breaker toward the active corridor step so sudden noise spikes do not jump across walls while genuine detours into other hallways still appear.
- **Browser-only motion fusion (3-tier automatic fallback):**
  - **Tier 1 (GPS-only):** Used whenever motion sensors are unsupported, denied, silent (`> 1.5 s` without samples), on desktop browsers, or during non-corridor/transfer steps (`stairs`, `elevator`, `building-link`, `outdoor`).
  - **Tier 2 (Stage 1)** classifies activity as moving, stationary, or unknown. It holds a fixed corridor anchor while motion appears stationary. Relocation requires three consecutive eligible fixes with distinct timestamps. Their corridor matches must be more than 12 m from the anchor and within 5 m of each other, with no more than 10 seconds between fixes. A detected step or sensor silence also releases the hold. During motion, detected step lengths inform the continuity score and the status reads `Approx. corridor GPS + motion`.
  - **Tier 3 (Stage 2)** uses a 120-particle filter constrained to the route graph's walking-cell rules. It uses gravity-projected gyroscope yaw, accounts for phone-only turns and suppresses step-only tracking when direction is ambiguous. The bridged dot disappears 15 seconds after the last accepted fix was captured or on the 20th unanchored step, whichever comes first. If valid gyroscope samples stop for 1.5 seconds, the filter falls back to GPS, then uses accelerometer gating on subsequent eligible fixes. A fix captured after gyroscope recovery is required to restart the particle filter. `PARTICLE_PDR_ENABLED` stays off pending physical iOS and Android verification.
- **Floor and tracking transitions** reset the tracker when the route enters or leaves a transfer, changes floors, or resumes from the background. Delayed fixes captured before or at the transition cannot seed the new state. If a raw GPS dot appeared while waiting for the walking surface, the first corridor estimate requires a fix captured after the surface loaded. Ordinary same-floor corridor advances preserve tracking. Each unique GPS timestamp is processed once.
- **iOS motion permission:** **Get Directions** stays dedicated to the required GPS request so optional motion prompts never threaten its 15-second acquisition deadline. On Android Chrome, `devicemotion` starts automatically on Step 1. On iOS 13+ Safari (`DeviceMotionEvent.requestPermission`), the app triggers the one-time native motion prompt on the visitor's first guided-navigation tap (**Next step**, **Previous**, **Show full floor**, or **Back to steps**) if still unprompted, and falls back silently to Tier 1 if denied.
- **Outdoor steps** are exempt from indoor corridor snapping and motion prediction, retaining standard footprint-overlap and page-bounds checks. When a floor walking surface is unavailable or still loading, the tracker falls back to raw footprint-overlap gating without seeding indoor particles from raw readings.
- The zoomed step map frames strictly around the route step's markers and path (`src/components/RouteMap.tsx`) so live GPS drift does not jump or zoom out the viewport.

The browser requests high accuracy and zero cached age. A stale or invalid first fix gets one retry within the original 15-second deadline; permission denial and cancellation end acquisition. A reading is eligible only when fresh (`LOCATION_FRESH_MS = 2000`) and valid. The live overlay disappears when readings become stale (or, when Stage 2 bridging is enabled and direction is resolved, once the bounded 15 s / 20-step window expires). Browsers may combine GPS with network signals, and reported accuracy can understate indoor error. Phone use requires HTTPS and location permission; localhost works on the computer running the app. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

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

GPS readings and all browser motion/PDR streams (`DeviceMotionEvent`, step counts, anchors, and particle clouds) stay strictly in active browser memory and are omitted from provider prompts, API requests, logs, and persistent session state. The app sends only the building candidates derived on-device. Reloading clears all transient readings and motion state. The browser and operating system may use their own location service.

Offline synthetic simulations cover signal processing, grid connectivity, and comparative tracking behavior. On-campus checks in Android Chrome and iOS Safari still need to verify gyroscope axes and polarity and measure corridor-level error, drift, and recovery. Include slow walking and smooth movement with few detectable steps, such as wheelchair travel. Compare the time it takes the stationary hold to release against the GPS-only corridor matcher using the same route and checkpoints. Guided route progress selects the displayed floor.
