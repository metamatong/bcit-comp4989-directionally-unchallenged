# Project walkthrough

1. Open the app and choose Find my location to upload or capture a campus photo.
2. Show the preview and obtain per-photo consent before sending the full image and four detail views.
3. Submit the photo. The first API request reads visible room labels. The second searches all source labels exactly, then compares the image and crops with matching floor plans and full label/geometry evidence. If no usable exact match is available, visual shortlisting remains supported.
4. Review the single best supported location region on its relevant floor plan, along with observable matches and uncertainty. The source links refer only to that plan's full image and original PDF.
5. Confirm only if the estimate agrees with the actual surroundings. An insufficient-evidence result should lead to another view.
6. Clear removes the current result. If a configured Gemini fallback model was needed, the result labels it.

There is no Campus library, plan-search screen, introductory promotional banner, fictional landmark or sample location. A provider error shows setup/retry guidance. Never present mocked results as a successful live localization. Users see one unverified photo estimate and can type or speak a destination. Routes appear as approximate visual overlays on the official campus map and stop at mapped building vicinities; indoor room paths are not available. Sentence-based directions and AR are not implemented. Nothing has been deployed or submitted as coursework.
