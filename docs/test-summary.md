# Verification record

Verified locally on 29 September 2026. These tests measure software behavior, not diagnostic accuracy.

Mobile verification was completed on 30 September 2026: all six tests and static analysis passed, and a fresh ARM64 debug APK was built and installed over the existing emulator app. The API health check confirmed SQLite and unavailable inference mode; the advisor portal returned HTTP 200.

| Check                                                                                       | Result                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Production npm dependency audit                                                             | Zero known vulnerabilities after patched NestJS/sharp upgrades                                                                 |
| NestJS API TypeScript compilation                                                           | Passed                                                                                                                         |
| React TypeScript/Vite production build                                                      | Passed                                                                                                                         |
| Backend workflow/authorization tests                                                        | 9 passed                                                                                                                       |
| FastAPI input, fixture, unavailable, unsupported, abstention and production-guard tests     | 8 passed                                                                                                                       |
| Dart static analysis (lib and test)                                                         | Passed, no issues                                                                                                              |
| Flutter capture, SQLite migration/reconnect, refresh throttling and rejected upload/reminder tests | 6 passed                                                                                                                  |
| Full HTTP workflow, default unavailable mode                                                | Passed                                                                                                                         |
| Full HTTP workflow, explicitly labelled fixture mode with versioned sample advice           | Passed                                                                                                                         |
| Chrome advisor login, overview, case photo/detail, response and mobile-width overflow check | Passed                                                                                                                         |
| Chrome admin drafting / separate content-reviewer publication                               | Passed                                                                                                                         |
| Android APK build and emulator                                                              | ARM64 debug APK built; installed and launched on Pixel 7 / Android 16 emulator                                                 |
| Emulator farmer journey                                                                     | Passed: demo sign-in, backend field creation, gallery photo, offline submission, force-stop/restart and exactly-once reconnect |
| Real model/provider inference                                                               | Not run: no licensed model or credentials supplied                                                                             |
| Agronomic field accuracy / treatment review / low-end phone budgets                         | Not evaluated                                                                                                                  |

The HTTP checks exercise persistent fields, photo decoding/upload, duplicate submission/image/job/follow-up prevention, cross-owner access denial, worker completion, admin assignment, advisor response and farmer retrieval. The fixture run also checks that the matched advice card is explicitly development-only. Default inference was restored to unavailable after testing.

The Flutter SQLite test closes and reopens a real local database after a simulated connection loss following an image upload. On reconnect, overlapping synchronization requests produce one case, one image entry and one job through a test server adapter. This verifies client behavior alongside independent server deduplication tests. A separate Android emulator test also captured a gallery image, disabled emulator networking, submitted a draft, force-stopped and restarted the app, restored networking and verified exactly one server case and job. Networking was restored in a finally block. This is not a physical low-end-device field trial.

The real-adapter abstention test mocks the external HTTP provider. It confirms that an unvalidated accepted result becomes uncertain. It does not count as live real inference or prove any classification performance.

Known non-fatal environment notices: Node reports experimental built-in SQLite support; Starlette's test client emits an AnyIO deprecation warning. The first Android build's Gradle daemon exited; memory was reduced for the retry. A SQLite test-driver major-version mismatch was fixed by pinning sqlite3 2.9.4.

The latest mobile tests initially timed out while loading with native-hook path-provider implementations. Pinning path_provider_android 2.2.22 and path_provider_foundation 2.4.2 restored all six tests in an isolated copy and the main project; static analysis also passed. These pins retain platform-channel implementations for the tested Flutter 3.38.4 toolchain.

The subsequent APK build encountered stale generated paths after the local Flutter SDK moved from Documents/flutter to dev/flutter. Regenerating package configuration with flutter pub get resolved this, and the final Flutter APK build passed.

See README and operations.md for remaining integrations and acceptance criteria. No production or field-readiness claim is made.
