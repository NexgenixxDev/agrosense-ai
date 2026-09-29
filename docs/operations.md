# Local operations and handover

SQLite files and private images live under `data/` by default. API and worker must share the same database and image directory on local disk. Migrations in `services/api/migrations` are applied automatically and recorded once in the migrations table. WAL, foreign keys and a five-second busy timeout are enabled. Analysis jobs use a 90-second lease, a 45-second HTTP timeout and at most three automatic attempts. The provider must honor the job idempotency key to prevent repeated billing after ambiguous failures.

## Development accounts

Run `npm run seed` with `DEV_AUTH=true` outside production. Accounts: farmer-demo, farmer-other, advisor-demo, admin-demo, reviewer-demo. Sessions expire after eight hours. Tokens are hashed in the database, held in browser sessionStorage and Android secure storage. These accounts do not verify a real person. Disable development authentication before deployment. Production SMS/OTP, privileged MFA and refresh-token rotation are outstanding integrations, not simulated features.

The seed inserts account records and one prominently labelled sample advice card. It does not invent farms or cases. `node scripts/e2e.mjs` creates a synthetic development case and follow-up to exercise persistence. Its synthetic leaf-shaped image is not diagnostic evidence. Remove development datasets before any supervised field deployment.

## Recovery

- Offline mobile drafts keep their photo and submission UUID in the app's private storage. Foreground sync retries with capped exponential backoff, and manual retry is available. Editing locks once submitted. Android may delay work while the application is closed; reopen to synchronize.
- Worker crashes leave a lease that another worker can claim after expiry. Once automatic attempts are exhausted, a farmer can retry the failed job.
- Inference not configured is an explicit persisted unavailable result. It is not a processing crash. After configuring a model, create a new crop check rather than silently changing a historical result.
- Review responses can be retrieved without push notifications. No staffing/response-time promise is made.
- Notification permission denial preserves the reminder in the mobile list. Android uses inexact local scheduling, so delivery can vary with battery restrictions.

## Backup

For a consistent database-and-image snapshot, stop both API and worker briefly. Use SQLite's `.backup` command or the online backup API; do not copy only the main database file while WAL writers are active. Back up the private image directory with the snapshot, encrypt backups and restrict access. Restore to a separate location and verify migrations, image access and counts before switching services. Agree retention and deletion handling before collecting real farmer data.

## Deployment boundaries

Docker Compose is provided as a single-host example and has not been deployed to a remote environment. `docker compose -f infra/compose.yaml run --rm api node dist/seed.js` seeds only a development environment. Serve the portal and API behind HTTPS; keep FastAPI private. A release mobile build needs a production HTTPS API_URL and signing keys. The Android scaffold uses a development signing configuration and is not ready for store publication.

Remaining operational work includes OTP/MFA, encrypted backups and restore drill, service monitoring, deletion/export and training-consent withdrawal workflows, S3 integration, push delivery, multi-host scaling, alerting and accessibility/device/performance field testing. Do not expose development authentication to untrusted networks.
