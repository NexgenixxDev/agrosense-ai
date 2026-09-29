# API contract

`openapi.json` documents the implemented development surface. Regenerate with `node scripts/generate-contract.mjs`. It intentionally does not advertise OTP, account deletion or signed-object-upload routes that are not yet implemented.

The Flutter client is maintained in `apps/farmer-mobile/lib/data.dart`; server validators live in `services/api/src/schemas.ts`. Clients must parse case details separately from summary list rows: summary `symptoms` and `analysis` fields are serialized JSON strings; full case details decode them to objects. All identifiers are UUIDs except the explicitly named development accounts. Dates use UTC ISO strings; portal display uses Africa/Windhoek.

If generating a future Dart client, use OpenAPI Generator's `dart-dio` target against this file. Do not import TypeScript declarations into Dart. No generator dependency is required for the current maintained client.
