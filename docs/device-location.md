# Device location and walking

GPS is required when a visitor taps **Get Directions**. The browser requests a fresh location reading immediately from that tap, before photo processing. If photo processing takes long enough for the reading to age, the app refreshes it before matching. On the device, the app intersects its reported accuracy area with the official campus building footprints. The metadata-only location request sends matching building IDs, accuracy, capture time and source hash; raw coordinates stay in browser memory. If the browser cannot provide GPS, the route request stops with an error.

The app combines that building match with the photo labels and automatically selects the strongest source-linked starting estimate. GPS narrows the building; it cannot identify the floor. The photo evidence identifies the floor and nearby place. Visitors are not asked to choose a starting room or doorway.

## Guided directions

**GO** starts a fresh foreground GPS watch and opens step-by-step directions only after a fresh reading arrives. The route step selects the floor map. The position dot and reported accuracy area update from each fresh GPS reading when that floor has a geographic alignment. GPS does not identify floors or advance route steps; the visitor advances with the route controls. Tracking stops when the visitor returns to the route overview, finishes, or leaves the page.

The browser requests high accuracy, zero cached age and a 15-second timeout. A reading is eligible only when fresh and valid. The live overlay disappears when readings become stale. Browsers may combine GPS with network signals, and reported accuracy can understate indoor error. Phone use requires HTTPS and location permission; localhost works on the computer running the app. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

## Building and floor coverage

The archived official WGS84 building-footprint data includes SE12, SW03, SW05 and SW01. That gives GPS a building-level match for each requested building, but it does not align a floor drawing to latitude and longitude.

The location catalogue covers all 89 supplied floor plans. Fourteen have approximate drawing-to-coordinate alignments: all four SE12 floors, all four SW01 floors, all four SW03 floors, and both SW05 floors. The other 75 plans remain unavailable; the app hides the dot on those drawings instead of projecting it to a guessed location.

| Building | Building GPS footprint | Floor-plan GPS alignment |
| -------- | ---------------------- | ------------------------ |
| SE12     | Available              | Floors 1–4               |
| SW03     | Available              | Floors 1–4               |
| SW05     | Available              | Floors 1–2               |
| SW01     | Available              | Floors 1–4               |

SE12 floor 3 retains its original source-bound, four-corner control alignment; its held-out corner discrepancy is approximately 1.05 m. Twelve other floors use separate full-page registrations to their building's archived WGS84 footprint: SE12-F1/F2/F4, SW01-F1/F2/F3, all four SW03 floors, and both SW05 floors. Their boundary-registration RMS values are 0.76/0.97/0.26 m for SE12-F1/F2/F4, 0.72/0.75/0.86 m for SW01-F1/F2/F3, 0.37/0.28/0.98/1.00 m for SW03-F1/F2/F3/F4, and 0.09/0.09 m for SW05-F1/F2. SW01-F4 is aligned by stacking its drawing to SW01-F3 at three corresponding stair cores; a fourth stair-core pair was held out and differed by approximately 1.62 m. Boundary-registration RMS values measure fit to the outline used to construct the transform; they are not independent ground-truth checks, indoor GPS accuracy, or a general error bound. The stacked-core held-out check is a drawing-to-drawing consistency check, not a field measurement. The source PDF hash is pinned for every alignment so a changed drawing cannot silently reuse its old transform.

The footprint registration approach differs from SE12-F3's direct corner correspondences because most plans do not show the same identifiable geographic corner controls. It uses the plan outline and official footprint for those floors; SW01-F4 uses stacked stair-core correspondences. This provides approximate overlays for the requested set, but it does not establish true indoor GPS accuracy. Visitors are not asked to place or approve coordinates.

The public [BCIT Map Portal](https://experience.arcgis.com/experience/724c4dc67eed40fdbe8e5bbc358e8c55) exposes campus GIS layers such as building footprints, accessible routes and elevator/lift locations. Its public layers do not provide a floor-plan-to-coordinate transform for every floor. The supplied plans are architectural PDFs with different page extents, rotations and drawing bounds. To improve confidence in these approximate alignments and cover the remaining plans, coordinate-aware indoor CAD/BIM or GIS source data would be preferable; transforms should remain source-hash-bound and be validated against independent controls. This is a source-data/development task; visitors should never be asked to set coordinates. [BCIT Campuses & Directions](https://www.bcit.ca/about/visit/campuses-directions/)

## Privacy and remaining gaps

GPS readings stay in active browser memory and are omitted from provider prompts, logs and persistent session state. The app sends only the building candidates derived on-device. Reloading clears readings. The browser and operating system may use their own location service.

Floor-plan alignment is not enabled for all 89 supplied floors yet. The remaining 75 plans need source-grounded georeference data. No transform is copied to a differently shaped drawing, and no GPS dot is fabricated when alignment is absent.
