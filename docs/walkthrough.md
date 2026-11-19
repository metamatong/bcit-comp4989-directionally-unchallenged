# Project walkthrough

1. Upload or take a photo, then tap **Next**. The image stays on the device until the visitor taps **Go**.
2. Enter a destination such as `SW03 2605` and tap **Go**. Optionally enable device location if standing where the photo was taken.
3. The configured AI provider reads the photo once for labels and visible features. Exact source lookup uses those readings and optional GPS building candidates to estimate a starting area. The app displays **Starting area estimated**, then calculates the route over the saved reviewed graph without further model calls.
4. Walking directions show one arrow-separated overview with the building passage and floor changes. Below it, maps and their A/B descriptions form one vertical stack. **Show full floors** changes all map views together; **Source plans** expands the official PDF links. Optional **Device position** controls are below the maps. No route confirmation prompts interrupt this flow.
5. Cross-building travel can use only mapped building connections. Visitors can walk between SE12 and SW03 and continue from SW03 to SW01. On floors 2–4, the SW03–SW01 crossings stay indoors. Floor 1 includes an outdoor walk between the marked doors.
6. After locating the starting floor, expand **Choose a point on the map** to set a corridor or room-area point. Select **Choose a map point** in the destination form for an unnamed destination. The server checks the chosen cell against the current sheet and graph.
7. **Start over** clears the trip. Location evidence and trip editing are optional details below the route.

The visitor catalogue covers all 89 supplied plans. Routes use connected floor walking areas and reviewed transfers. Missing coverage is explicit. Photo-based starting estimates and walking routes have not been independently validated on campus. A provider error shows setup/retry guidance. This walkthrough performs no deployment or coursework submission.
