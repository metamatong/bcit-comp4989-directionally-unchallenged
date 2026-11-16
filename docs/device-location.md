# Device location and walking

Select **Use device location with this photo** only while standing where the photograph was taken, including for uploads. Submitting requests one reading alongside the two-stage Gemini analysis. Photo analysis proceeds if geolocation fails. The reading is checked for validity and acquisition age at receipt, then retained as historical evidence through slow analysis. Acquisition time and reported horizontal accuracy appear with the result. Request another reading only after confirming you are still at the photo location. Replacing/removing the photo, cancelling or resetting clears the association and invalidates pending callbacks. Confirming the photo location ends pending acquisition while preserving any accepted historical reading.

Gemini reads labels and compares plans independently of device readings. The browser subsequently checks overlap with a supported camera region or official building footprint. All hypotheses remain selectable. Drawing and device areas remain independent. Building overlap cannot select a floor. Printed labels and doorway reference points alone cannot supply a camera region. Route starts require a confirmed photo hypothesis and an explicitly selected approved point.

## Walking and permissions

Select **Show my position** to start one foreground watch. **Stop tracking** cancels it. **Resume tracking** requires a new reading. Browsing itinerary pages changes the view. After physically transferring floors or buildings, select **I’m on this floor**, then resume. Confirmation applies to the individual floor visit, including repeat visits to one page.

Acquisition requests high accuracy, zero cached age and a 15-second timeout. Valid coordinates and non-negative accuracy with acquisition age between zero and two seconds at receipt are eligible. Watch timestamps must increase. Raw readings draw an approximate position and its reported uncertainty area. A 500 ms freshness check removes the live overlay after two seconds even if callbacks stop. The dated last reading and separately labeled confirmed route start remain available. Raw projection preserves off-corridor readings and the viewport stays fixed. Visitors manually follow route transfers and outdoor geometry gaps.

Tracking pauses on page hide, permission revocation and route replacement/unmount. Returning offers explicit resume. Phone use requires HTTPS and permission. Localhost works on the computer running the app. An ordinary HTTP LAN address cannot provide geolocation. This change includes no deployment. Physical Android/iOS and lock-screen behavior remain unverified.

Browsers can combine GPS and network signals, and may ignore a high-accuracy request. Reported accuracy may understate indoor error. The two-second window is an initial prototype-derived setting in `src/location/browser-location.ts` that needs device evaluation. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## Source provenance and floor coverage

`data/campus/geolocation/bcit-pilot-footprints.json` archives official BCIT WGS84 footprints for SW1 (OBJECTID 19), SW3 (21) and SE12 (33), retrieved November 16, 2026. The exact query URL, date and SHA-256 appear in `calibrations.json`. Existing source PDFs remain unchanged. Original BCIT attribution and usage restrictions continue to apply. [Official GIS layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/Bsite_Building_Footprint_20241022/FeatureServer/0) · [Source terms](data.md)

All twelve official pilot drawings were inspected for extent and orientation. Every coverage entry binds to its individual PDF hash.

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

Readings stay in active browser memory and are omitted from application requests, Gemini prompts, logs and persistent storage. Photo and walking consent use separate controls. The browser/operating system may use its own location service. Reload clears the readings. Historical photo evidence and the latest walking reading have separate lifecycles. The application saves no walk history.

The November 16 implementation passed 259 unit/API tests, the TypeScript/production build and data validation. In-memory DOM tests cover opt-in and photo-only journeys, request-body privacy, tracking, manual floor confirmation, staleness, late callbacks, revocation and teardown. Geometry tests cover crop reversal, aspect ratio, source hashes and reported-area comparison. Provider and device inputs are mocked. Browser/screenshot checks were skipped as requested. Live Gemini comparison, physical-phone behavior and on-campus accuracy remain unverified.

Field evaluation should compare photo-only and combined selection on the same independently confirmed locations. Measure walking error, fresh-reading coverage, false apparent agreement and misleading position displays at corridors, entrances and transfers on at least two phones. Record reference uncertainty, devices and sample counts. Improved indoor positioning remains unverified.
