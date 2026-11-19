# Project walkthrough

1. Upload or take a photo, then tap **Next**. The image stays on the device until the visitor taps **Get Directions**.
2. Enter a destination such as `SW03 2605` and tap **Get Directions**. Check **Accessibility: prefer elevators** to change the default stair preference. Optionally enable device location if standing where the photo was taken.
3. The configured AI provider reads the photo once for labels and visible features. Exact source lookup uses those readings and optional GPS building candidates to estimate a starting area. The app displays **Starting area estimated**, then calculates the route over the saved reviewed graph without further model calls.
4. Walking directions show one arrow-separated overview with the building passage and floor changes. Below it, maps and their A/B descriptions form one vertical stack. **Show full floors** changes all map views together; **Source plans** expands the official PDF links. Optional **Device position** controls are below the maps. Tap **GO** to open one route step and map at a time. Advance manually with **Next step**, go back with **Previous**, and mark the final instruction with **Finish route**. **Route overview** returns to the stacked maps. This does not verify position or start tracking.
5. Cross-building travel can use only mapped building connections. The current SE12–SW03 links are available; a route requiring a transfer to or from SW01 cannot use an inferred crossing.
6. **Start over** clears the trip. Location evidence and trip editing are optional details below the route.

The visitor catalogue covers all 89 supplied Burnaby plans. Routes require complete floor approaches and reviewed transfers. Missing coverage is explicit. Photo-based starting estimates and walking routes have not been independently validated on campus. A provider error shows setup/retry guidance. This walkthrough performs no deployment or coursework submission.
