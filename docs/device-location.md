# Device location and walking

GPS is required when a visitor taps **Get Directions**. The browser requests a fresh location reading immediately from that tap, before photo processing. If photo processing takes long enough for the reading to age, the app refreshes it before matching. On the device, the app intersects its reported accuracy area with the official campus building footprints. Both extraction and metadata-only location requests send matching building IDs, accuracy, capture time and source hash; raw coordinates stay in browser memory. Only matching building IDs are forwarded to the photo provider as context, never raw coordinates or reading metadata. If the browser cannot provide GPS, the route request stops with an error.

The app combines that building match with the photo labels and automatically selects the strongest source-linked starting estimate. GPS narrows the building; it cannot identify the floor. The photo evidence identifies the floor and nearby place. Visitors are not asked to choose a starting room or doorway.

## Guided directions

A complete walking route opens on its first step and starts a foreground GPS watch automatically. The step is visible while the watch waits for a fresh reading. The route step selects the floor map, and the visitor advances with the route controls. The position dot and reported accuracy area update from fresh GPS readings when the floor has a geographic alignment. Tracking stops when the visitor opens the route overview, finishes, or leaves the page. **Back to steps** returns to the current step and starts a new watch.

The browser requests high accuracy and zero cached age. A stale or invalid first fix gets one retry within the original 15-second deadline; permission denial and cancellation end acquisition. A reading is eligible only when fresh and valid. The live overlay disappears when readings become stale. Browsers may combine GPS with network signals, and reported accuracy can understate indoor error. Phone use requires HTTPS and location permission; localhost works on the computer running the app. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## Building and floor coverage

The archived official WGS84 footprints cover 43 of the 45 supplied buildings, including SE12, SW03, SW05 and SW01. Building-footprint coverage does not establish floor alignment or indoor routing coverage.

The catalogue contains all 89 supplied plans. Only SE12 floor 3 currently exposes an approximate geographic alignment, retaining its original four-corner controls and approximately 1.05 m held-out discrepancy. The other 88 plans hide the dot. Indoor GPS accuracy remains unmeasured.

The PR's thirteen additional alignments remain in `data/campus/geolocation/calibration-candidates.json` for development. Twelve proposed outline registrations generate every control, including the fourth control, from the same hard-coded transform. Their small residuals are algebraic consistency checks, not independent evidence that the drawing and footprint align. SW01 floor 4 uses stacked stair cores but inherits the unverified SW01 floor-3 geographic alignment. Its drawing-to-drawing check does not resolve that dependency.

`scripts/prepare-geolocation.ts` preserves these proposed registrations separately and writes unavailable visitor records for their floors. The candidate artifact is not loaded by the visitor catalogue. Enabling an additional floor requires reproducible source-bound outline correspondences or independent geographic control evidence, including validation of any source-floor dependency. Do not promote it by changing a status flag or accepting generated residuals alone.

| Building | Building footprint | Active floor alignment | Pending candidates |
| --- | --- | --- | --- |
| SE12 | Available | Floor 3 | Floors 1, 2, 4 |
| SW03 | Available | None | Floors 1–4 |
| SW05 | Available | None | Floors 1–2 |
| SW01 | Available | None | Floors 1–4 |

All original source PDF hashes and geographic provenance remain intact. GPS never determines a floor; route progress selects the displayed plan.

## Privacy and remaining gaps

GPS readings stay in active browser memory and are omitted from provider prompts, logs and persistent session state. The app sends only the building candidates derived on-device. Reloading clears readings. The browser and operating system may use their own location service.

Floor-plan alignment is not enabled for all 89 supplied floors yet. The remaining 88 plans need source-grounded alignment evidence. No transform is copied to a differently shaped drawing, and no GPS dot is fabricated when alignment is absent.
