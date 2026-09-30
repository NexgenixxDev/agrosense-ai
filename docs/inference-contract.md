# Inference adapter contract

The private FastAPI service accepts `POST /analyze` with `X-Service-Token`, `Idempotency-Key` and JSON `{case_id, crop, image_base64}`. The API strips metadata, checks decoded JPEG/PNG and limits dimensions before forwarding. The FastAPI port must remain private.

A case may hold up to two photographs, but only the first uploaded one is sent for analysis; the second is kept for advisor review. The farmer app currently captures one. Sending both needs a contract change (for example an `images_base64` list), coordinated with the provider translator.

The real adapter forwards the same payload to an operator-supplied HTTPS endpoint with `Authorization: Bearer INFERENCE_API_KEY`. This is an integration contract, **not** an assertion that Plantix or another vendor implements this protocol. Implement a vendor-specific translator after obtaining its documentation, license and credentials. The endpoint must honor Idempotency-Key to avoid repeat billing after ambiguous timeouts.

Response: `{status, model_version, mode, candidates: [{condition}], reason, quality_flags: []}`. Status is accepted, uncertain, unsupported, retake or unavailable. Mode is real, fixture or unavailable. At most three candidates; never include made-up confidence percentages. Real model identity and conditions must match configuration. Accepted predictions are downgraded to uncertain until MODEL_VALIDATED=true following documented local evaluation. That switch alone is not evidence of validation.

The configured provider is responsible for non-plant detection, blur detection, out-of-distribution rejection and calibrated acceptance rules. The built-in image check catches invalid and near-blank images only. Fixture mode is solely for integration testing and returns visibly marked fixed content. Production refuses fixtures. No agronomic treatment text from the provider is displayed; the API selects a matching published, versioned knowledge-base card.

Missing dependencies: licensed model/provider, coverage evidence, provider-specific adapter, local held-out evaluation and agronomist-approved guidance. No local performance or diagnostic accuracy is asserted.

## Claude mode

`AI_MODE=claude` sends each photo to Claude (`CLAUDE_MODEL`, default `claude-opus-5-5`) with `ANTHROPIC_API_KEY`. Claude returns a fixed JSON shape (assessment, condition, confidence, summary, next steps), which the service maps onto the result contract: identified → accepted, uncertain → uncertain, retake → retake, not the selected crop → unsupported. The summary becomes `reason`; `confidence` and `next_steps` are extra fields. Every result carries the `ai_suggestion` flag and is an AI suggestion from one photo, not a verified diagnosis. The prompt tells Claude not to name pesticides or doses. All four crops are assessed. API errors return 502 so the worker retries; a declined request becomes an uncertain result.

Each analysis is one Claude request with one image (roughly 1,500–2,500 input tokens), billed to the key's account.
