# Project walkthrough

1. Open the app. Upload photo and Take a photo are immediately available under Find my location; choose either without opening a popup.
2. Enter a destination such as `SW03 3615`. The notice beside the button explains that submitting sends the photo and its detail views to Google Gemini.
3. Select **Find my route** to submit the photo. The first API request reads visible room labels. The second searches all source labels exactly, then compares the image and crops with matching floor plans and full label/geometry evidence. If no usable exact match is available, visual shortlisting remains supported.
4. With a destination entered, the app shows the reviewed starting points in the proposed photo area. Select **Start at …** only for the point where you are standing. Multiple destination matches show their plan locations for selection.
5. The first result is the full walking itinerary. On the revision 28 pilot map, SE12 room 302 → SW03 office 2082 shows the SE12 third-floor window-side corridor, the indoor connecting passage, the SW03 third-floor east elevator and the second-floor walk to the office door. Each floor has its own map and arrows. Transfers use the reviewed departure and arrival locations.
6. Use **One floor at a time** to navigate the itinerary manually. Expand **Edit photo or destination** to change the trip, or **Photo location evidence** to inspect the original estimate. A photo-only submission still shows the estimate and source plan. **Start over** clears the journey.

There is no Campus library, plan-search screen, introductory promotional banner, fictional landmark or sample location. A provider error shows setup/retry guidance. Never present mocked results as a successful live localization. Physical traversal and real-photo localization accuracy remain unmeasured. Nothing has been deployed or submitted as coursework.
