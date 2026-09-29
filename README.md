# AgroSense AI

A local development implementation of the AgroSense build brief: Flutter Android farmer app, React/TypeScript advisor and admin portal, NestJS API, **SQLite backend**, independently runnable worker and Python/FastAPI inference boundary.

**Status:** working development workflows, not a production-ready or field-validated diagnostic service. No licensed crop model or provider credentials were supplied. Default inference persists an honest `unavailable` result; mahangu and sorghum use advisor referral. Fixtures are explicit, never fallback diagnoses. Agronomist-reviewed production content and production identity integration remain required.

## Start locally

Prerequisites: Node 24+ (tested with 25.2.1), Python 3.12, Flutter 3.38.4/Dart 3.10.3, Android SDK/JDK 17. Backend and worker use Node's built-in SQLite driver; this Node version emits an experimental-driver warning.

```sh
npm ci
cp .env.example .env
npm run seed
python3.12 -m venv services/ai/.venv312
services/ai/.venv312/bin/pip install -r services/ai/requirements.lock
```

Start each component in its own terminal:

```sh
# Root
npm run dev:api
npm run worker
npm run dev:web

# In services/ai
.venv312/bin/uvicorn app:app --host 127.0.0.1 --port 8100
```

Open http://127.0.0.1:5173 for the portal. Choose advisor, administrator or content reviewer. API: port 4100; private AI: port 8100. The web development proxy forwards `/api` to the API. A deployed web server must provide the same proxy; Vite's build alone is static assets.

```sh
cd apps/farmer-mobile
flutter pub get
flutter run --dart-define=DEV_AUTH=true --dart-define=API_URL=http://10.0.2.2:4100
# Installable development APK:
flutter build apk --debug --target-platform=android-arm64 --dart-define=DEV_AUTH=true
```

The emulator uses `10.0.2.2` to reach this Mac. On a physical phone use a reachable development host address. Plain HTTP is allowed only in the Android debug manifest. A release build needs HTTPS, real authentication, release signing and approved content. Never enable development sign-in for a public deployment.

## What works

- Persistent SQLite fields/cases, private validated JPEG/PNG uploads, source-metadata stripping and authorization.
- Idempotent case/photo/job synchronization, durable leased jobs and bounded retry; separate processing and review states.
- Explicit unavailable, fixture, real-provider-contract, uncertain, unsupported and retake paths; no fabricated percentages or treatment text.
- Farmer camera/gallery capture, persistent drafts, foreground reconnect sync, cached case details and guidance, local reminders, review requests and outcome observations.
- Advisor queue and responses; admin assignments/account directory/audit; reviewer-only versioned guidance publication. Old case guidance stays traceable after newer versions are published.
- Visibly labelled development accounts/content, English interfaces with agricultural green styling.

## Tests and demo

```sh
npm test
npm run build
cd services/ai && .venv312/bin/pytest -q
cd ../../apps/farmer-mobile && flutter test
# With all local services running, from root:
node scripts/e2e.mjs
node scripts/browser-check.mjs
```

The end-to-end script creates labelled test records using a synthetic non-diagnostic image. The browser script uses installed Google Chrome and adds a labelled test advisor response. Screenshots are in `docs/screenshots/`. See [test status](docs/test-summary.md) for measured results and unverified criteria.

To test the fixture path, set `AI_MODE=fixture` for FastAPI and restart it. Fixture coverage is only `tomato / fixture_leaf_condition`. The sample guidance is marked development-only. Restore `AI_MODE=unavailable` afterward. To configure real inference, follow [the adapter contract](docs/inference-contract.md); do not point it at an undocumented vendor URL or claim local validation without evidence.

## Project map

- `apps/farmer-mobile/`: Flutter Android application.
- `apps/advisor-admin-web/`: React/TypeScript portal.
- `services/api/`: NestJS API, SQLite migrations, worker and authorization/workflow tests.
- `services/ai/`: FastAPI boundary, validated provider responses and tests.
- `packages/contracts/openapi.json`: implemented API methods and schemas; regenerate with `node scripts/generate-contract.mjs`.
- `infra/`: single-host Docker Compose examples; not yet deployment-tested.
- `docs/`: architecture assumptions, extracted product brief, integration requirements and operating notes.

Dart accesses JSON via a maintained client in `lib/data.dart`, not imported TypeScript types. SQLite replaces PostgreSQL at the user's request. SQLite jobs and private local image storage are initial single-host adaptations; see [architecture](docs/architecture.md) and [operations](docs/operations.md).

## Outstanding before field use

Real licensed inference and verified coverage; provider-specific translation and billing idempotency; held-out local evaluation including non-plant/blur rejection; qualified content review; OTP/MFA/refresh sessions; push notifications; deletion/export/consent-withdrawal flows; linked follow-up photographs and second-photo capture; background synchronization while app is closed; fully localized strings and reviewed translations; operational monitoring and backup drill; physical low-end device and performance testing. Arial is requested as a font family but no redistributable Arial asset was supplied, so Android may fall back to a system font. No crop-loss, accuracy, revenue or field-impact claims are made.
