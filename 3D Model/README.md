# BCIT spatial twin



From the repository root, install the navigation app dependencies with `npm ci`, then run:



    npm --prefix "3D Model" ci

    npm --prefix "3D Model" start



Open http://127.0.0.1:3210/ for the Three.js campus twin or http://127.0.0.1:3210/?view=se12-3-4 for the SE12 floor pair. Existing /three links also open the twin. Choose Records inspector to reach the sheet and network records at /inspector. Use SPATIAL_PORT to change the port.



Choose buildings and floors independently. Selecting two floors displays their published stair and elevator links. Navigable area draws the navigation app's compiled walking cells. SE12 and SW3 include source-bound wall and stair meshes. Estimated walls are switchable. Floor separation, heights and intermediate stair geometry are schematic. The 26 confirmed door locations and source-bound wall cuts are recorded under local-analysis/doorway-review.



The server reads the parent repository's plans, floor graphs and navigation network. Rebuild using npm run build inside this folder. Published changes to routing data should be verified against the same app checkout. The local-analysis folder contains the inputs and reports for the inspector and its review pages.



The Three.js view marks each published inter-floor stair endpoint with one raised gold stair symbol. Symbols use a common display size and orientation. Select two floors of one building to see arrows for the permitted directions between their landings.



Click either stair symbol on a visible two-floor connection to frame both landings and highlight their arrow in cyan. The floor connections list also provides a focus button for each stair pair. Fit view clears the highlight.



Building checkboxes select any combination of buildings. Each selected building has its own floor checkboxes. The viewer draws campus footprints and places source-matched calibrated sheets using the navigation app’s geographic alignment. Where published alignment is unavailable, the inspector uses a source-matched outline candidate when available, otherwise a uniform fit of the drawing extent to the footprint. Estimated fits cannot establish exact indoor positions, especially on partial floors. Buildings without a footprint appear in a separate row marked off map. Floor heights remain schematic. Pink arrows show building passages and green arrows show schematic outdoor links. Both endpoint sheets must be visible. Expand Selected floor connections for identifiers and directions. Open /three?pair=SW3,SW5 for the SW03 and SW05 view.


Map view is north-up. Both map views use a 1660 × 3908 lossless crop rendered from the official BCIT Burnaby Campus Wayfinding PDF in `data/campus/raw/bcit_wayfinding.pdf`. Six building centres register the artwork to the GIS footprint layer. Texture resolution is independent of model scale. Floor separation is exaggerated for inspection. Drawing extents are estimated from the largest connected ink group after page-frame removal. The default view shows light drawing lines on a transparent background. Full sheets restores the original paper, drawing margins and disconnected details. Regenerate the source-bound extents with extract-drawing-extents.py (Pillow, NumPy and SciPy).

The default Three.js view renders the whole Burnaby campus over the official wayfinding map. Building solids follow the archived GIS footprints. Heights use the number of catalogued floors, or one illustrative level where floor plans are unavailable. The illustrated basemap has approximate registration. Click a building to open its floor inspector, or use the View selector. The SE12 floor-pair and building-pair links open directly in floor inspection.

Choose a pair under Connected buildings to inspect its published passage or outdoor links. Mapped floor plans opens on the endpoint floors, clipped to their GIS footprint polygons above the wayfinding map. Use the floor checkboxes to change levels and drag to inspect links in perspective. Buildings without a mapped footprint can be inspected in Floor inspector. Ground footprints may differ from upper-floor extents.
