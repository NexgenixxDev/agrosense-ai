# Architecture and assumptions

Build location: a new independent repository, preserving existing projects. The supplied PDF is the product specification; its extracted text is in product-brief.txt. SQLite replaces PostgreSQL at the user's request.

## Components

- Flutter Android application: camera/gallery, field records, SQLite drafts and caches, reconnect synchronization, local reminders, case results and advisor responses.
- React/TypeScript portal: assigned advisor queue, case review, administrator assignments and content workflow.
- NestJS API: authenticated ownership checks, versioned content, private image endpoints, idempotent submissions, SQLite migrations.
- Independently runnable Node worker: durable SQLite jobs with atomic claim, leases and bounded retries; calls a private FastAPI inference adapter.
- FastAPI: validated images and explicit unavailable, fixture and real HTTP adapter modes. No proprietary provider protocol is assumed. A real endpoint must implement the documented contract and supply verified model coverage.

## Material implementation choices

SQLite uses WAL, foreign keys, busy timeout and short transactions. A SQLite jobs table replaces Redis/BullMQ for the initial single-host deployment, avoiding two independent state stores. API and worker share the same local disk; do not place the database on a network filesystem or horizontally replicate writers. Private filesystem images replace S3 for the local development slice; clients only access images through authorized API routes. Production object storage and signed uploads remain an integration task.

Development sessions are enabled only with an explicit setting outside production. There is no fabricated SMS verification. Production authentication requires an external identity/SMS integration. Development fixture analysis and sample advice remain visibly marked. Production content requires a reviewer role independent of administrator privileges. No mahangu diagnosis is enabled.

## Order and validation

1. Schema, migrations, API contract, fields and persistent cases.
2. Authenticated image upload, idempotent jobs, AI contract, results and abstention.
3. Advisor assignment/response, versioned advice, follow-ups and reminders.
4. Portal and Flutter capture with persistent drafts and synchronization.
5. Authorization, concurrency/retry, advice workflow and AI validation tests; build clients and document limitations.

No real crop classifier, licensed API credentials, agronomist-reviewed content, SMS account, FCM account or local evaluation dataset was supplied. Complete unblocked work and report these dependencies honestly. The AI-integrated MVP is not complete until real inference and reviewed content have been exercised.
