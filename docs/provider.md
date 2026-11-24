# AI provider configuration and verification

OpenAI and Groq documentation checked November 17, 2026; the Gemini record below retains its October 16 checks. Select `AI_PROVIDER=gemini` (default), `openai`, or `groq` on the server. All providers perform the first photo evidence-extraction stage. Source localization, GPS narrowing and reviewed-graph navigation use the structured result without later model calls. The configured primary model is preserved; ordered Gemini model fallbacks are supported. Exact account quotas and free-tier eligibility require operator verification; a key alone cannot establish them.

## Paid OpenAI

The private `.env` and `.env.example` include:

```dotenv
AI_PROVIDER=gemini
OPENAI_API_KEY=
OPENAI_MODEL=luna-6.0
```

Leave the key blank until ready. To activate OpenAI, add a paid API key, change `AI_PROVIDER=openai` and restart the existing server. Gemini credentials and `AI_FREE_TIER_CONFIRMED` are ignored while OpenAI is selected. Switching back to Gemini restores its existing model, fallback list and free-tier eligibility check. Unknown provider names and missing selected-provider credentials disable analysis instead of switching providers.

`luna-6.0` is an explicit application alias for **`gpt-6-luna`**, the public ID listed by OpenAI. The [Luna model record](https://developers.openai.com/api/docs/models/gpt-6-luna) documents image input, function calling and bounded reasoning. Bootstrap reports the actual API model ID. Other model IDs can be configured directly; the operator must verify image input, Responses function calling, low reasoning support, billing and project access. Local configuration validation does not establish account eligibility or generation access.

## Groq

Set `AI_PROVIDER=groq`, `GROQ_API_KEY`, and `GROQ_MODEL=qwen/qwen3.8-27b`. Groq's [Responses API](https://console.groq.com/docs/responses-api) is OpenAI-compatible and supports image inputs and function calling. Qwen 3.8 27B supports vision and tools, with a limit of three images per request. The adapter creates one labeled contact sheet from the request's image views to fit that limit. This reduces per-image resolution, so evaluate localization quality with the actual photo workflow before relying on it.

Groq says inference data is not retained by default, but may be temporarily logged for reliability or abuse investigations for up to 30 days. Check the account's [data controls](https://console.groq.com/docs/your-data). Free-tier limits vary by model and account; confirm current quota in GroqCloud.

`server/openai-provider.ts` uses `POST https://api.openai.com/v1/responses`, server-side Bearer authentication, high-detail inline image inputs, forced named functions and `parallel_tool_calls=false`. Shared uppercase tool schemas are converted to JSON Schema without changing property names, enums or exact labels. OpenAI uses `strict=true` with closed objects, required schema properties, nullable optional fields and bounded text. Nullable optional values are restored to omitted fields before application validation. Groq retains its existing non-strict tool contract. Existing Zod and source-grounding validators remain authoritative. The app sends fresh text/images for each stage and does not replay stored provider conversations. [Image input](https://developers.openai.com/api/docs/guides/images-vision), [function calling](https://developers.openai.com/api/docs/guides/function-calling).

Requests set `store=false`, omit provider conversation IDs, and do not request reasoning summaries. OpenAI uses streaming SSE and applies only the terminal completed response. First-event and first-output timings are observed during transport. Incomplete responses, partial calls, invalid JSON arguments, undeclared functions and refusals are rejected. Reasoning content is discarded, while token counts are retained in sanitized metrics. No photo bytes enter app sessions or logs. Disabling response storage does not establish zero provider retention; [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) still apply.

Application ceilings (`AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY`) apply to paid OpenAI too, including each retry. Hosted workers reserve the same shared budget per API key. Each request uses the remaining stage deadline, including preparation, transport, response reading and backoff. OpenAI and Groq allow at most two transport attempts for transient connection, timeout, rate-limit, output-length or server errors, provided the shared time and request budgets allow them. Retry-After is honored, and delays longer than eight seconds are returned to the visitor. Output-length failures regenerate from the original input with concise-output guidance under the same token and time budgets. Partial tool calls are discarded. Authentication and model-access errors are explicit and sanitized. `AI_TIMEOUT_MS` is used only for calls without a stage deadline and as the Gemini failover threshold. There are no OpenAI backup models or automatic provider switches. Photo selection alone never calls either provider.

Automated regression tests use mocked OpenAI transport and source protocol fixtures. The verification record reports separately authorized live photo checks, their sample sizes and remaining accuracy limitations.

## Gemini adapter

Google Gemini Developer API. The new-install default is **`gemini-3.5-flash-lite`**, with **`gemini-3.8-flash`** as its default fallback. Google's current [model catalogue](https://ai.google.dev/gemini-api/docs/models) describes both as multimodal models; the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) currently lists free-tier input and output for them. The existing private `.env` model is preserved and remains the primary model unless changed by the operator. An existing 3.8 primary defaults to a 3.5 Flash-Lite backup. Explicit fallback lists, including an empty list, are preserved. Photo analysis sends the actual image, official plan PNGs and geometry summaries. Selection/detail use 4,096/8,192 total output-and-thinking token allowances.

Free-tier content may be used to improve Google's products. DirectionallyUnchallenged uses local source/visual retrieval and does not use provider context caching or Google Search/Maps grounding. Verify the selected primary and fallback models are available to the specific API project before confirming eligibility.

Gemini enforces quotas per Google Cloud project, and limits vary by model. Every key in the same project shares its quota. Use backups only for allocations authorized for this application. To increase the application's allowance, check the project's limits in AI Studio and request an increase where eligible. [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [Google API terms, section 2(d)](https://developers.google.com/terms#d_api_limitations)

The supported stable Flash model IDs are Gemini 3.5 Flash, 3.5 Flash-Lite, 3.6 Flash, 3.7 Flash and 3.8 Flash. Gemini 2.5 is excluded from configuration even though Google currently lists the Flash models as available: access is restricted to existing users, and they are not appropriate new defaults or fallbacks. A successful model-list or metadata response does not prove generation access. Google's exact model availability and quotas can change and must be checked for the operator's account.

## Activation

1. Verify the API project's free tier, model access and quotas in AI Studio.
2. Set the required `GEMINI_API_KEY` in the private server environment. The two optional backups are `GEMINI_API_KEY_2` and `GEMINI_API_KEY_3`, in that order. Blank slots and duplicate keys are skipped. Configure the primary model and `GEMINI_FALLBACK_MODELS`, then set `AI_FREE_TIER_CONFIRMED=true` after verifying eligibility for every configured project.
3. The app allows 120 attempts per rolling minute and 1,200 per rolling 24 hours by default. Retries and attempts on backup keys and models count toward both totals. Set `AI_REQUESTS_PER_MINUTE` (1–400) and `AI_REQUESTS_PER_DAY` (1–20,000) to override the defaults. Local counters reset on restart. Hosted workers share a rolling Redis budget identified by the primary key.
4. Restart the existing server and refresh. Gemini readiness is displayed directly. `AI_DEFAULT_MODE` is unused and old browser mode preferences are cleared.
5. Choose a photo, then select **Analyze photo against BCIT plans** or **Find my route** to send it to Gemini. No request occurs merely because a key is configured.

Missing configuration displays setup guidance and disables/rejects photo submissions. Source plans remain internal; only relevant plans are shown with location results. Adding JSON or changing browser storage cannot restore fictional locations. Model failover is limited to the configured Gemini list; there is no automatic alternate-provider fallback. Paid OpenAI is available only through explicit server selection.

## Transport, budgets and privacy

The Gemini adapter sends keys in the server-side `x-goog-api-key` header and uses `generateContent` with forced typed functions. See [function calling](https://ai.google.dev/gemini-api/docs/function-calling). The first app API request calls Gemini to read photo labels from the context image and four original-image crops, with optional GPS-derived building candidates but without source-plan or room-list hints. The server validates the building IDs, source hash and reading freshness, then forwards only building IDs as uncertain context. The model must not use context to complete an obscured identifier or invent a building/floor label. The next app API request resolves the extracted labels against source records without calling Gemini. A normal successful submission makes one provider request. Retries and configured failovers remain bounded by the extraction budget. Ambiguous label matches produce an unresolved starting place.

On an upstream HTTP 429, the server tries the next available key for the same model. Each worker remembers when it can retry that key and model, using Google's `Retry-After` header, the `google.rpc.RetryInfo` delay in the response body, or a 60-second default. The first eligible key in the configured order handles the next photo. Once every key for a model reaches quota, the server can try the next configured model. If all combinations are cooling down, it returns HTTP 429 with the earliest retry time and makes no upstream request. An application budget error stops the request immediately.

Photo analysis bounds attempts by the remaining stage deadline. When another model is available, the primary attempt uses the shorter `AI_TIMEOUT_MS` threshold (15 seconds by default). A timeout or overload temporarily moves that model behind the other choices for at least 60 seconds. The configured primary regains priority after recovery.

The server deadline for reading labels is 45 seconds. The browser allows ten additional seconds for the extraction response. The later metadata lookup and graph calculation perform no model inference. The Vercel function limit and session lease are 120 seconds. The provider distinguishes a model deadline, a transport failure and user cancellation, including failures while reading the response body. Server logs emit an `AI request metric` JSON record for each provider transport attempt, including successful attempts. Fields include provider, model, operation, outcome, image count and pixels, serialized request bytes, preparation and header timings, elapsed milliseconds, upstream request ID and available input/cached/output/reasoning token counts and a sanitized incomplete-response reason. OpenAI streaming adds first-event and first-output timings. Groq image counts describe the input views before contact-sheet packing. Metrics exclude photos, labels, prompts, destinations, credentials and visitor session IDs. Run `npm run ai:metrics -- /path/to/server.log` to report attempt counts and p50/p95 latency grouped by provider, model, operation and outcome. Percentiles require a representative sample to support performance conclusions. HTTP 500/502/503/504 retries stay bounded and longer retry intervals are returned to the user. Inline request bodies are limited to 18 MB.

Photos are resized locally and sent transiently to the local server and Google after per-photo consent. Original metadata is removed; no media enters app storage, session logs or the source-image cache. No hidden reasoning is requested or saved. Provider terms still govern Google's handling. Images, drawings and retrieved text are evidence, never instructions.

Authentication/model-access errors, quota exhaustion, overload, blocked content and incomplete responses are distinguished without exposing raw provider messages. An HTTP 404 identifies unavailable model access and points to the primary/fallback settings. If all models fail, the final error preserves distinct sanitized reasons from every attempt; an inaccessible backup does not hide a retryable primary overload or quota error. Authentication, cancellation and local-budget failures still take precedence. The adapter omits custom temperature/top-p/top-k parameters. [Google troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Source lookup after extraction

The provider receives the full photograph, its original-image detail crops and optional validated GPS-derived building IDs. Raw coordinates remain in the browser. Source labels, doorway positions and connection records are searched locally after extraction. All original labels and source hashes remain available to exact retrieval. No plan image or destination is included in a later provider request in the visitor workflow.

## Live verification history

On October 16, a text-only forced-tool diagnostic reproduced the reported failure chain: the configured Gemini 3.8 Flash returned HTTP 503 (high demand), while both implicit 2.5 backups returned HTTP 404 with Google indicating they were unavailable to new users. Metadata requests had returned HTTP 200 with `generateContent` support for every checked model, so metadata alone was insufficient. One text-only check of the replacement 3.5 Flash-Lite backup also returned 503. The obsolete defaults and error masking were corrected, but current provider capacity remains an external limitation. No user photo was sent by these diagnostics and no photo-localization accuracy is established.

The key was accepted by Google's model-list endpoint, which listed the configured model. An earlier text/tool request succeeded; that text-location feature has now been removed with the fictional data. It did not establish photo-localization accuracy.

The initial all-plan photo request sent the user's hallway screenshot plus eight official plan overview sheets (nine images, about 6.57 MB of JSON). It encountered HTTP 503 and a timeout. Later diagnostics isolated a response-cap error as described below. These are historical checks, not a claim of a completed current live photo walkthrough. No new provider calls were made to validate the demo removal.

## Incomplete response diagnosis and handling

A subsequent October 15 diagnostic reproduced the user's “unsupported response” error. Google returned HTTP 200 with `finishReason: MAX_TOKENS`, a model content object without `parts`, and 1,726 thinking tokens against the selection stage's 1,800-token output cap. There was no usable tool result. The old parser required content parts before inspecting completion status, so it mislabeled token exhaustion as an unsupported format. Only response shape, completion status and token counts were inspected; no thought text or photo bytes were logged.

Photo reading, optional shortlisting and comparison use bounded low thinking with `includeThoughts: false`. Gemini 3 receives `thinkingLevel: low`; Gemini 2.5 receives a 1,024-token `thinkingBudget`, as its API does not accept the Gemini 3 setting. Selection allows 4,096 total output/thinking tokens; detail comparison allows 8,192. The adapter caps any requested output allowance at 8,192. These are maximum allowances, not a requirement to generate that many tokens. Request counts, deadlines, forced functions, source checks and region validation remain enforced. Google's [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) explains that the output cap includes thinking and can produce an empty result when reached.

The adapter checks [completion status](https://ai.google.dev/api/generate-content#FinishReason) before parsing visible parts. `MAX_TOKENS` and `CONTINUATION` become `providerError.code: response_limit`, with an explicit retry allowed by the caller. Partial tool calls are rejected even if their arguments look valid. Provider-blocked input/output receives `blocked`; empty answers and malformed model calls receive a clear response error. There is no automatic continuation or retry for these cases. Thought parts are discarded before visible-output validation, and opaque signatures are preserved only on transient visible conversation parts. Raw provider messages and extra metadata are not exposed.

The first post-fix live check timed out; one further bounded check received HTTP 429 from Google. Testing stopped at that quota response. No successful post-fix live photo comparison or campus position is claimed; the existing key and model were retained. Automated regression tests cover the observed empty `MAX_TOKENS` response, incomplete valid-looking calls, blocking, empty answers, thought filtering, output bounds, HTTP error propagation, rollback and an explicit successful retry with mocked responses.


## Model selection setup fix

The private `.env` selected `gemini-3.6-flash`, with the key present and free-tier confirmation set. The old allowlist accepted only 3.5 Flash-Lite and 3.8 Flash, causing the generic “setup required” message despite correct file loading. 3.6 Flash is now supported after checking its [image/function-calling capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.6-flash) and low-thinking support. A read-only model metadata request using the existing key returned HTTP 200 and `generateContent` support. This check generated no content and did not verify photo localization.

Startup now reports whether the key, free-tier confirmation or model choice needs attention; the same notice reaches the API/client without exposing configuration values or credentials. The current `.env` passes configuration validation. Restart the existing server to load the fix. No key or user-selected model was replaced.
