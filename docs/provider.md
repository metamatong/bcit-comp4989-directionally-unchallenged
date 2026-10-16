# Gemini provider configuration and verification

Documentation checked October 15, 2026. Gemini is the only photo-analysis provider. The configured primary model is preserved; ordered Gemini model fallbacks are now supported. Exact account quotas and free-tier eligibility require operator verification; a key alone cannot establish them.

## Selected adapter

Google Gemini Developer API. The new-install default is **`gemini-2.5-flash-lite`**, with **`gemini-2.5-flash`** as its default fallback. Google's current [model catalogue](https://ai.google.dev/gemini-api/docs/models) describes both as multimodal models; the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) currently lists free-tier input and output for them. The existing private `.env` model is preserved and remains the primary model unless changed by the operator. Photo analysis sends the actual image, official plan PNGs and geometry summaries. Selection/detail use 4,096/8,192 total output-and-thinking token allowances.

Free-tier content may be used to improve Google's products. CampusLens uses local source/visual retrieval and does not use provider context caching or Google Search/Maps grounding. Verify the selected primary and fallback models are available to the specific API project before confirming eligibility.

Quotas are account/project dependent and must be inspected in AI Studio. The public documentation does not guarantee a universal RPM/TPM/RPD allowance; do not copy outdated numbers from a blog. [Rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

The code retains the previously configured Gemini 3.x IDs in its supported list for existing private configurations. The new-install default and fallback are the documented 2.5 Flash family. Google's exact model availability and quotas can change and must be checked for the operator's account.

## Activation

1. Verify the API project's free tier, model access and quotas in AI Studio.
2. If no private `.env` exists, copy `.env.example`. Set `GEMINI_API_KEY`, a primary model, an ordered `GEMINI_FALLBACK_MODELS` list, and `AI_FREE_TIER_CONFIRMED=true` only after the account check.
3. Set application request ceilings to fit the project's actual limits. Defaults are six attempts/minute and 60/day; these are application ceilings, not provider entitlements. Counters reset on process restart.
4. Restart the existing server and refresh. Gemini readiness is displayed directly. `AI_DEFAULT_MODE` is unused and old browser mode preferences are cleared.
5. Upload a photo, consent to sending that image, and select Analyze. No request occurs merely because a key is configured.

Missing configuration displays setup guidance and disables/rejects photo submissions. Source plans remain internal; only relevant plans are shown with location results. Adding JSON or changing browser storage cannot restore fictional locations. Model failover is limited to the configured Gemini list; there is no paid or alternate-provider fallback.

## Transport, budgets and privacy

The adapter sends keys in the server-side `x-goog-api-key` header and uses `generateContent` with forced typed functions. See [function calling](https://ai.google.dev/gemini-api/docs/function-calling). The orchestrator normally makes one shortlist request and, if appropriate, one detail request. Only the single best location is returned; if the plans do not support a defensible result, it abstains.

Each photo request allows at most 30 seconds; the entire comparison has a 60-second deadline and client transport allows 70 seconds. Inline bodies are capped at 18 MB. HTTP 500/502/503/504 have at most two retries with roughly one/two seconds of exponential backoff and up to 250 ms jitter. Retry-After is honored; waits above eight seconds are returned to the user instead. If a model remains unavailable, exhausts its quota, times out or returns an unusable response, the next configured Gemini model is tried. Authentication errors, user cancellation and local request-budget exhaustion do not trigger model fallback. Every attempt consumes the shared budget. All work is cancellable and incomplete state rolls back.

Photos are resized locally and sent transiently to the local server and Google after per-photo consent. Original metadata is removed; no media enters app storage, session logs or the source-image cache. No hidden reasoning is requested or saved. Provider terms still govern Google's handling. Images, drawings and retrieved text are evidence, never instructions.

Authentication/model-access errors, quota exhaustion, overload, blocked content and incomplete responses are distinguished without exposing raw provider messages. The adapter omits custom temperature/top-p/top-k parameters. [Google troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Live verification history

The key was accepted by Google's model-list endpoint, which listed the configured model. An earlier text/tool request succeeded; that text-location feature has now been removed with the fictional data. It did not establish photo-localization accuracy.

The initial all-plan photo request sent the user's hallway screenshot plus eight official plan overview sheets (nine images, about 6.57 MB of JSON). It encountered HTTP 503 and a timeout. Later diagnostics isolated a response-cap error as described below. These are historical checks, not a claim of a completed current live photo walkthrough. No new provider calls were made to validate the demo removal.

## Incomplete response diagnosis and handling

A subsequent October 15 diagnostic reproduced the user's “unsupported response” error. Google returned HTTP 200 with `finishReason: MAX_TOKENS`, a model content object without `parts`, and 1,726 thinking tokens against the selection stage's 1,800-token output cap. There was no usable tool result. The old parser required content parts before inspecting completion status, so it mislabeled token exhaustion as an unsupported format. Only response shape, completion status and token counts were inspected; no thought text or photo bytes were logged.

Both photo stages now request `thinkingLevel: low` and `includeThoughts: false`. Selection allows 4,096 total output/thinking tokens; detail comparison allows 8,192. The adapter caps any requested output allowance at 8,192. These are maximum allowances, not a requirement to generate that many tokens. Request counts, deadlines, forced functions, source checks and region validation remain enforced. Google's [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) explains that the output cap includes thinking and can produce an empty result when reached.

The adapter checks [completion status](https://ai.google.dev/api/generate-content#FinishReason) before parsing visible parts. `MAX_TOKENS` and `CONTINUATION` become `providerError.code: response_limit`, with an explicit retry allowed by the caller. Partial tool calls are rejected even if their arguments look valid. Provider-blocked input/output receives `blocked`; empty answers and malformed model calls receive a clear response error. There is no automatic continuation or retry for these cases. Thought parts are discarded before visible-output validation, and opaque signatures are preserved only on transient visible conversation parts. Raw provider messages and extra metadata are not exposed.

The first post-fix live check timed out; one further bounded check received HTTP 429 from Google. Testing stopped at that quota response. No successful post-fix live photo comparison or campus position is claimed; the existing key and model were retained. Automated regression tests cover the observed empty `MAX_TOKENS` response, incomplete valid-looking calls, blocking, empty answers, thought filtering, output bounds, HTTP error propagation, rollback and an explicit successful retry with mocked responses.


## Model selection setup fix

The private `.env` selected `gemini-3.6-flash`, with the key present and free-tier confirmation set. The old allowlist accepted only 3.5 Flash-Lite and 3.8 Flash, causing the generic “setup required” message despite correct file loading. 3.6 Flash is now supported after checking its [image/function-calling capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.6-flash) and low-thinking support. A read-only model metadata request using the existing key returned HTTP 200 and `generateContent` support. This check generated no content and did not verify photo localization.

Startup now reports whether the key, free-tier confirmation or model choice needs attention; the same notice reaches the API/client without exposing configuration values or credentials. The current `.env` passes configuration validation. Restart the existing server to load the fix. No key or user-selected model was replaced.
