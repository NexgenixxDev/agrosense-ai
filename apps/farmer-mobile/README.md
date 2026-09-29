# AgroSense farmer app

See the repository root README for complete setup. Android 10+; Flutter 3.38.4 and Dart 3.10.3 were used.

```sh
flutter pub get
flutter run --dart-define=DEV_AUTH=true --dart-define=API_URL=http://10.0.2.2:4100
flutter test --reporter expanded
```

Development sign-in is off unless explicitly enabled. The default API_URL targets the Android emulator's host. Release builds require HTTPS and configured production authentication. Drafts, cached cases/guidance and reminder metadata use on-device SQLite. Photos live in app-private documents; session tokens use platform secure storage. Foreground/resume synchronization uses stable submission UUIDs, backoff and a single-flight guard.

Only local development signing is configured. The source requests Arial, but Android may use a fallback because no licensed font file has been bundled. Strings currently use English; full localization remains pending.
