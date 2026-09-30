# Inference adapter contract

The private FastAPI service accepts `POST /analyze` with `X-Service-Token`, `Idempotency-Key` and JSON `{case_id, crop, image_base64}`. The API strips metadata, checks decoded JPEG/PNG and limits dimensions before forwarding. The FastAPI port must remain private.

A case may hold up to two photographs, but only the first uploaded one is sent for analysis; the second is kept for advisor review. The farmer app currently captures one. Sending both needs a contract change (for example an `images_base64` list), coordinated with the provider translator.

The real adapter forwards the same payload to an operator-supplied HTTPS endpoint with `Authorization: Bearer INFERENCE_API_KEY`. This is an integration contract, **not** an assertion that Plantix or another vendor implements this protocol. Implement a vendor-specific translator after obtaining its documentation, license and credentials. The endpoint must honor Idempotency-Key to avoid repeat billing after ambiguous timeouts.

Response: `{status, model_version, mode, candidates: [{condition}], reason, quality_flags: []}`. Status is accepted, uncertain, unsupported, retake or unavailable. Mode is real, fixture or unavailable. At most three candidates; never include made-up confidence percentages. Real model identity and conditions must match configuration. Accepted predictions are downgraded to uncertain until MODEL_VALIDATED=true following documented local evaluation. That switch alone is not evidence of validation.

The configured provider is responsible for non-plant detection, blur detection, out-of-distribution rejection and calibrated acceptance rules. The built-in image check catches invalid and near-blank images only. Fixture mode is solely for integration testing and returns visibly marked fixed content. Production refuses fixtures. No agronomic treatment text from the provider is displayed; the API selects a matching published, versioned knowledge-base card.

Missing dependencies: licensed model/provider, coverage evidence, provider-specific adapter, local held-out evaluation and agronomist-approved guidance. No local performance or diagnostic accuracy is asserted.

## Claude and Gemini modes

`AI_MODE=claude` sends each photo to Claude (`CLAUDE_MODEL`, default `claude-opus-5-5`) with `ANTHROPIC_API_KEY`. Claude returns a fixed JSON shape (plant, assessment, condition, confidence, summary, solutions), which the service maps onto the result contract: identified → accepted, uncertain → uncertain, retake → retake, no plant in the photo → unsupported. The summary becomes `reason`; `plant`, `confidence` and `next_steps` (the solutions) are extra fields. A crop check may send `crop: "unknown"`; the AI then identifies the plant itself, which is how the simplified farmer app works. Every result carries the `ai_suggestion` flag and is an AI suggestion from one photo, not a verified diagnosis. Solutions start with cultural and low-cost steps and may name a type of product (for example a copper-based fungicide) but never doses, mixing rates or spray schedules; the farmer is told to follow the label and ask an extension officer or agro-dealer which products are approved in Namibia. All four crops are assessed. API errors return 502 so the worker retries; a declined request becomes an uncertain result.

Each analysis is one Claude request with one image (roughly 1,500–2,500 input tokens), billed to the key's account.

`AI_MODE=gemini` does the same with Google Gemini (`GEMINI_MODEL`, default `gemini-2.5-flash`) and `GEMINI_API_KEY`, using the same instructions and JSON schema, so results look identical in the apps and the printed report. Gemini's free tier has request limits: a rate-limited request returns 502 and the worker retries it with increasing delays. On the free tier Google may use submitted photos to improve its products. A response blocked by Gemini's safety filters becomes an uncertain result.
