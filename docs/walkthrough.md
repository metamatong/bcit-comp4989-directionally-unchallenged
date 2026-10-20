# Project walkthrough

1. Open the app. Upload photo and Take a photo are immediately available under Find my location; choose either without opening a popup.
2. Show the preview and obtain per-photo send confirmation for the full image and its four detail views.
3. Submit the photo. The first API request reads visible room labels. The second searches all source labels exactly, then compares the image and crops with matching floor plans and full label/geometry evidence. If no usable exact match is available, visual shortlisting remains supported.
4. Review the result below the photo input: a single best supported location region on its relevant floor plan, along with observable matches and uncertainty. The source links refer only to that plan's full image and original PDF.
5. Confirm only if the estimate agrees with the actual surroundings. An insufficient-evidence result should lead to another view.
6. Clear removes the current result. Remove photo discards the preview and consent, while Cancel analysis stops an active comparison. Opening Coverage & privacy preserves the inline photo. If a configured Gemini fallback model was needed, the result labels it.

There is no Campus library, plan-search screen, introductory promotional banner, fictional landmark or sample location. A provider error shows setup/retry guidance. Never present mocked results as a successful live localization. Walking directions and campus accuracy remain unverified. Nothing has been deployed or submitted as coursework.
