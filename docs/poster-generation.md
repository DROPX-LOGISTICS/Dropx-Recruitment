# Recruit poster generation

Active Ads → Create Meta Ad → select station and designation → Generate poster with AI. Upload remains available. Choose a language, a light style, optional previous ad reference, contact details and confirmed job requirements. Preview/regenerate/download, then Use this poster hands the JPG to the existing upload flow. Generation never launches an ad.

Every output is exactly **1080 × 1920 JPEG (9:16)**. The prompt reserves a central brand strip and a central square for essential content. The compositor adds original logos after generation. AI typography still needs human preview; a prompt does not guarantee Meta's crops or placement overlays. The actual placement preview must be checked.

Branding comes from recruitment_locations.station_id → stations.provider_id / location_model_id → active, company-scoped providers/location_models. Amazon NOW, Amazon EDSP/XPT (last mile), AMXL and Flipkart are distinct. Unknown/inconsistent mappings use DropX-only branding. No frontend brand override is accepted. See public/brand/SOURCES.md for asset sources.

## Connection

The server supports an existing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) using Gemini's image-generation API. It also supports AI_GATEWAY_API_KEY or Vercel OIDC if image models are funded. Direct Gemini takes priority. The default image model is gemini-3.1-flash-image; the Gateway ID is google/gemini-3.1-flash-image. RECRUITMENT_POSTER_MODEL can override the model within the selected provider. Keys are never returned to the client.

Ops Pulse has GEMINI_API_KEY configured as a Vercel sensitive production variable. Vercel does not export that value, so it must be securely configured for Recruit as well (or provided as a shared environment variable) before direct generation can run. Text-model access alone does not guarantee image-model quota. No paid top-up is automatic.

## Boundaries

Requests require an authenticated Recruit session, Active Ads permissions and location/role scope. Role/location names and brand mapping are reloaded on the server. References are limited to accessible previous ads; image downloads only allow Meta CDN hosts, disallow redirects, and enforce byte/pixel limits. Responses are private/no-store. Cancellation/timeouts and bounded provider error messages preserve the upload fallback. Original brand PNGs are included in function tracing.

Verification: authorization/workspace/reference scope, automatic partner mapping, fixed output dimensions, logo composition, safe reference URLs, Gateway and direct Gemini response parsing, budget failures, production type/build checks and local desktop/narrow viewport UI checks. Live generation additionally needs the production image connection.
