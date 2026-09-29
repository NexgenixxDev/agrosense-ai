# Verification record

Verified locally on 29 September 2026. These tests measure software behavior, not diagnostic accuracy.

| Check                                                                                       | Result                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| NestJS API TypeScript compilation                                                           | Passed                                                     |
| React TypeScript/Vite production build                                                      | Passed                                                     |
| Backend workflow/authorization tests                                                        | 7 passed                                                   |
| FastAPI input, fixture, unavailable, unsupported, abstention and production-guard tests     | 8 passed                                                   |
| Dart static analysis (lib and test)                                                         | Passed, no issues                                          |
| Flutter capture widget and SQLite restart/reconnect tests                                   | 2 passed                                                   |
| Full HTTP workflow, default unavailable mode                                                | Passed                                                     |
| Full HTTP workflow, explicitly labelled fixture mode with versioned sample advice           | Passed                                                     |
| Chrome advisor login, overview, case photo/detail, response and mobile-width overflow check | Passed                                                     |
| Chrome admin drafting / separate content-reviewer publication                               | Passed                                                     |
| Android APK build and emulator                                                              | Packaging verification in progress; update before handover |
| Real model/provider inference                                                               | Not run: no licensed model or credentials supplied         |
| Agronomic field accuracy / treatment review / low-end phone budgets                         | Not evaluated                                              |

The HTTP checks exercise persistent fields, photo decoding/upload, duplicate submission/image/job/follow-up prevention, cross-owner access denial, worker completion, admin assignment, advisor response and farmer retrieval. The fixture run also checks that the matched advice card is explicitly development-only. Default inference was restored to unavailable after testing.

The Flutter SQLite test closes and reopens a real local database after a simulated connection loss following an image upload. On reconnect, overlapping synchronization requests produce one case, one image entry and one job through a test server adapter. This verifies client behavior alongside independent server deduplication tests; it is not a physical-device airplane-mode demonstration.

The real-adapter abstention test mocks the external HTTP provider. It confirms that an unvalidated accepted result becomes uncertain. It does not count as live real inference or prove any classification performance.

Known non-fatal environment notices: Node reports experimental built-in SQLite support; Starlette's test client emits an AnyIO deprecation warning. The first Android build's Gradle daemon exited; memory was reduced for the retry. A SQLite test-driver major-version mismatch was fixed by pinning sqlite3 2.9.4.

See README and operations.md for remaining integrations and acceptance criteria. No production or field-readiness claim is made.
