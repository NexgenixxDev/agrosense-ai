# Inference adapter contract

The private FastAPI service accepts `POST /analyze` with `X-Service-Token`, `Idempotency-Key` and JSON `{case_id, crop, image_base64}`. The API strips metadata, checks decoded JPEG/PNG and limits dimensions before forwarding. The FastAPI port must remain private.

The real adapter forwards the same payload to an operator-supplied HTTPS endpoint with `Authorization: Bearer INFERENCE_API_KEY`. This is an integration contract, **not** an assertion that Plantix or another vendor implements this protocol. Implement a vendor-specific translator after obtaining its documentation, license and credentials. The endpoint must honor Idempotency-Key to avoid repeat billing after ambiguous timeouts.

Response: `{status, model_version, mode, candidates: [{condition}], reason, quality_flags: []}`. Status is accepted, uncertain, unsupported, retake or unavailable. Mode is real, fixture or unavailable. At most three candidates; never include made-up confidence percentages. Real model identity and conditions must match configuration. Accepted predictions are downgraded to uncertain until MODEL_VALIDATED=true following documented local evaluation. That switch alone is not evidence of validation.

The configured provider is responsible for non-plant detection, blur detection, out-of-distribution rejection and calibrated acceptance rules. The built-in image check catches invalid and near-blank images only. Fixture mode is solely for integration testing and returns visibly marked fixed content. Production refuses fixtures. No agronomic treatment text from the provider is displayed; the API selects a matching published, versioned knowledge-base card.

Missing dependencies: licensed model/provider, coverage evidence, provider-specific adapter, local held-out evaluation and agronomist-approved guidance. No local performance or diagnostic accuracy is asserted.
