# Device location and walking

The visitor can check **Use device location with this photo** while standing at its capture location. After the one-pass photo extraction, the browser requests a fresh location reading and computes which official building footprints intersect its accuracy area. Only those building IDs, accuracy, timestamp and source hash are sent to the metadata-only location endpoint. The server checks freshness and source provenance, then intersects building candidates with exact photo-label matches. GPS cannot choose a floor or route point. A GPS contradiction produces an explicit unresolved location result.

The default is unchecked. Permission denial or acquisition failure is shown, and extracted labels can still resolve a unique place. Photo replacement, cancellation, page hiding and unmount cancel pending acquisition. Coordinates remain in browser memory. Current device location applies to the device now, so an uploaded photograph from another location should be tested with GPS unchecked.

Walking directions retain the explicitly started foreground watch. Raw position readings never advance the route.

## Walking and permissions

Expand **Device position** below the continuous map stack, then select **Show my position** to start one foreground watch. **Stop tracking** cancels it. **Resume tracking** requires a new reading. After physically transferring floors or buildings, select the new **Current floor**, then resume. Selection applies to the individual floor visit, including repeat visits to one page, and stops the previous watch. All route maps stay visible. Collapsing the controls preserves the watch and displays the active tracking floor in the summary.

Acquisition requests high accuracy and zero cached age. A stale or invalid first fix triggers one more request within the original 15-second deadline. Permission denial and cancellation end acquisition. Valid coordinates and non-negative accuracy with acquisition age between zero and two seconds at receipt are eligible. Watch timestamps must increase. Raw readings draw an approximate position and its reported uncertainty area. A 500 ms freshness check removes the live overlay after two seconds even if callbacks stop. The dated last reading and app-acquired route start remain available. Raw projection preserves off-corridor readings and the viewport stays fixed. Visitors manually follow route transfers and outdoor geometry gaps.

Tracking pauses on page hide, permission revocation and route replacement/unmount. Returning offers explicit resume. Phone use requires HTTPS and permission. Localhost works on the computer running the app. An ordinary HTTP LAN address cannot provide geolocation. This change includes no deployment. Physical Android/iOS and lock-screen behavior remain unverified.

Browsers can combine GPS and network signals, and may ignore a high-accuracy request. Reported accuracy may understate indoor error. The two-second window is an initial prototype-derived setting in `src/location/browser-location.ts` that needs device evaluation. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## Source provenance and floor coverage

`data/campus/geolocation/bcit-pilot-footprints.json` archives official BCIT WGS84 footprints for SW1 (OBJECTID 19), SW3 (21) and SE12 (33), retrieved November 16, 2026. The exact query URL, date and SHA-256 appear in `calibrations.json`. Existing source PDFs remain unchanged. Original BCIT attribution and usage restrictions continue to apply. [Official GIS layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/Bsite_Building_Footprint_20241022/FeatureServer/0) · [Source terms](data.md)

The visitor catalogue now records calibration availability for all 89 sheets. The additional official campus footprint response is archived as `bcit-burnaby-footprints.json`. It includes matches for 43 of the 45 supplied building IDs. NE21 and NW7 have no matching footprint. SE12 floor 3 retains its original controls and the other sheets use building-level evidence when available.

| Building | Floor | Device comparison | Walking overlay |
|---|---|---|---|
| SE12 | 3 | Camera region when available, otherwise building | Approximate prototype alignment |
| SE12 | 1 | Building footprint | Unavailable. Rotated partial drawing needs geographic controls. |
| SE12 | 2 | Building footprint | Unavailable. Different extent and incomplete main-corner correspondence. |
| SE12 | 4 | Building footprint | Unavailable. Similar rectangle requires independent geographic control review. |
| SW03 | 1–4 | Building footprint | Unavailable. Four independent geographic controls remain unresolved on each drawing. |
| SW01 | 1–4 | Building footprint | Unavailable. Four independent geographic controls remain unresolved on each drawing. |

SE12 floor 3 shares the prototype PDF hash `521d90e70cda6b4fd58c0e00219fdcefb8ff605787b36bf383d124a129e794f1`. Preparation reverses its crop (200,660)–(3800,1800) and resize to 2800 × 887 from a 4000-pixel-wide page render. Fitting occurs in full-page pixels before normalization to preserve aspect ratio. Three controls fit a similarity transform and the fourth is held out. Its approximately 1.06 m discrepancy measures that landmark's alignment. The ground footprint can differ from floor 3. Indoor device accuracy and a general drawing error bound remain unmeasured.

Add independently identified controls to `scripts/prepare-geolocation.ts`, regenerate with `node --import tsx scripts/prepare-geolocation.ts`, and run `npm run data:validate` before enabling another floor. Preserve source hashes, controls, residuals, held-out discrepancy, review notes and version. Changed sources require renewed review. Calibration supplies overlay projection only and has no route approval authority.

## Privacy and verification

Walking readings stay in active browser memory and are omitted from application requests, provider prompts, logs and persistent storage. Starting location tracking is separate from submitting a photo. The browser/operating system may use its own location service. Reload clears the readings. The application saves no walk history.

The November 16 implementation passed 259 unit/API tests, the TypeScript/production build and data validation. Those historical checks included an earlier photo-associated device option; that option is not part of the current visitor flow. In-memory DOM tests also cover tracking, manual floor confirmation, staleness, late callbacks, revocation and teardown. Geometry tests cover crop reversal, aspect ratio, source hashes and reported-area comparison. Provider and device inputs are mocked. Browser/screenshot checks were skipped as requested. Live photo comparison, physical-phone behavior and on-campus accuracy remain unverified.

Field evaluation should compare app-selected photo starts against independently verified reference locations, then separately evaluate the optional walking overlay. Measure start-selection errors, walking error, fresh-reading coverage and misleading position displays at corridors, entrances and transfers on at least two phones. Record reference uncertainty, devices and sample counts. Improved indoor positioning remains unverified.

Starting step-by-step directions with **GO** stops the overview position watch. Guided steps advance only through visitor button presses; no GPS update or timer advances them.
