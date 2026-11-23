# BCIT spatial twin

From the repository root, install the navigation app dependencies with `npm ci`, then run:

    npm --prefix "3D Model" ci
    npm --prefix "3D Model" start

Open http://127.0.0.1:3210/three for the Three.js model or http://127.0.0.1:3210/three?view=se12-3-4 for the SE12 floor pair. The root URL opens the full spatial inspector. Use SPATIAL_PORT to change the port.

Choose buildings and floors independently. Selecting two floors displays their published stair and elevator links. Navigable area draws the navigation app's compiled walking cells. SE12 and SW3 include source-bound wall and stair meshes. Estimated walls are switchable. Floor separation, heights and intermediate stair geometry are schematic. The 26 confirmed door locations and source-bound wall cuts are recorded under local-analysis/doorway-review.

The server reads the parent repository's plans, floor graphs and navigation network. Rebuild using npm run build inside this folder. Published changes to routing data should be verified against the same app checkout. The local-analysis folder contains the inputs and reports for the inspector and its review pages.

The Three.js view marks each published inter-floor stair endpoint with one raised gold stair symbol. Symbols use a common display size and orientation. Select two floors of one building to see arrows for the permitted directions between their landings.

Click either stair symbol on a visible two-floor connection to frame both landings and highlight their arrow in cyan. The floor connections list also provides a focus button for each stair pair. Fit view clears the highlight.
