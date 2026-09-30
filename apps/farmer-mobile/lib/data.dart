import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

// The server address the app was built with; the farmer can change it in the app.
const apiBase = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:4100',
);
const developmentLogin = bool.fromEnvironment('DEV_AUTH', defaultValue: false);
const uuid = Uuid();
typedef Json = Map<String, dynamic>;

class ApiException implements Exception {
  final int status;
  final String message;
  const ApiException(this.status, this.message);
  // A rejected request that will be rejected again: retrying cannot help.
  bool get permanent =>
      status >= 400 && status < 500 && status != 401 && status != 429;
  @override
  String toString() => message;
}

class FarmData extends ChangeNotifier {
  late Database db;
  String? token;
  Json? user;
  String server = apiBase;
  bool syncing = false;
  String status = 'Saved work stays available on this phone.';
  final secure = const FlutterSecureStorage();
  Timer? timer;
  DateTime? lastRefresh;
  // Background syncs refresh server data at most this often; farmer actions refresh at once.
  static const refreshInterval = Duration(minutes: 5);

  Future<void> init({
    String? databasePath,
    bool restoreSession = true,
    bool automaticSync = true,
  }) async {
    final path = databasePath ?? '${await getDatabasesPath()}/agrosense.db';
    db = await openDatabase(
      path,
      version: 2,
      onUpgrade: (d, from, to) async {
        if (from < 2) {
          await d.execute(
            'ALTER TABLE drafts ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0',
          );
        }
      },
      onCreate: (d, v) async {
        await d.execute(
          'CREATE TABLE drafts(id TEXT PRIMARY KEY, payload TEXT NOT NULL, photo TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, server_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, rejected INTEGER NOT NULL DEFAULT 0)',
        );
        await d.execute(
          'CREATE TABLE cache(key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        );
        await d.execute(
          'CREATE TABLE reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due_at TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0, scheduled INTEGER NOT NULL DEFAULT 0)',
        );
      },
    );
    if (restoreSession) {
      server = await secure.read(key: 'server') ?? apiBase;
      token = await secure.read(key: 'session');
      final saved = await secure.read(key: 'user');
      user = saved == null ? null : jsonDecode(saved);
    }
    if (automaticSync) {
      timer = Timer.periodic(const Duration(seconds: 20), (_) => sync());
    }
  }

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Object? body,
    List<int>? image,
  }) async {
    final uri = Uri.parse('$server$path');
    final headers = {
      'Content-Type': image == null ? 'application/json' : 'image/jpeg',
      if (token != null) 'Authorization': 'Bearer $token',
    };
    final response =
        await (method == 'GET'
                ? http.get(uri, headers: headers)
                : http.post(
                    uri,
                    headers: headers,
                    body: image ?? (body == null ? null : jsonEncode(body)),
                  ))
            .timeout(const Duration(seconds: 25));
    dynamic data;
    try {
      data = jsonDecode(response.body);
    } on FormatException {
      // e.g. a proxy's HTML error page; the status code still decides what happens.
      data = null;
    }
    // A 401 from sign-in means a wrong password, not an expired session.
    if (response.statusCode == 401 && !path.startsWith('/auth/')) {
      token = null;
      await secure.delete(key: 'session');
      notifyListeners();
      throw const ApiException(
        401,
        'Please sign in again. Your local drafts are safe.',
      );
    }
    if (response.statusCode >= 400) {
      throw ApiException(
        response.statusCode,
        (data is Map ? data['message'] : null) ?? 'Request failed',
      );
    }
    if (data == null) {
      throw ApiException(response.statusCode, 'Unexpected server response');
    }
    return data;
  }

  /// Turns what the farmer typed ("192.168.0.104", "192.168.0.104:4100" or a
  /// full URL) into a base URL, or null if it can't be one.
  static String? serverUrl(String input) {
    var s = input.trim();
    if (s.isEmpty) return null;
    if (!s.contains('://')) s = 'http://$s';
    final uri = Uri.tryParse(s);
    if (uri == null || uri.host.isEmpty || !uri.hasScheme) return null;
    final port = uri.hasPort ? uri.port : (uri.scheme == 'https' ? 443 : 4100);
    return '${uri.scheme}://${uri.host}:$port';
  }

  /// Checks that an AgroSense server answers at [input], then remembers it.
  /// The session is kept: it is the same server under a new address.
  Future<void> setServer(String input) async {
    final url = serverUrl(input);
    if (url == null) throw Exception('Type an address like 192.168.0.104');
    try {
      final r = await http
          .get(Uri.parse('$url/health'))
          .timeout(const Duration(seconds: 5));
      if (r.statusCode != 200 || jsonDecode(r.body)['status'] != 'ok') {
        throw const FormatException();
      }
    } catch (_) {
      throw Exception('No AgroSense server answered at $url');
    }
    server = url;
    await secure.write(key: 'server', value: url);
    lastRefresh = null;
    notifyListeners();
  }

  /// Signs in with a phone number and password (the real accounts).
  Future<void> signIn(String phone, String password) async => start(
    await request(
      '/auth/login',
      method: 'POST',
      body: {'phone': phone, 'password': password},
    ),
  );

  /// Creates a farmer account and signs straight in.
  Future<void> register(String name, String phone, String password) async =>
      start(
        await request(
          '/auth/register',
          method: 'POST',
          body: {'name': name, 'phone': phone, 'password': password},
        ),
      );

  Future<void> start(Json session) async {
    token = session['token'];
    user = Map<String, dynamic>.from(session['user']);
    await secure.write(key: 'session', value: token);
    await secure.write(key: 'user', value: jsonEncode(user));
    notifyListeners();
    try {
      await refresh();
    } catch (_) {}
  }

  /// Ends the session here and on the server, and forgets this account's data
  /// on the phone (cached results and unsent photos), so the next person
  /// signing in doesn't see or upload them.
  Future<void> signOut() async {
    try {
      await request('/auth/logout', method: 'POST', body: {});
    } catch (_) {}
    token = null;
    user = null;
    await secure.delete(key: 'session');
    await secure.delete(key: 'user');
    for (final d in await drafts()) {
      final photo = File(d['photo'] as String);
      if (await photo.exists()) await photo.delete();
    }
    await db.delete('drafts');
    await db.delete('cache');
    lastRefresh = null;
    notifyListeners();
  }

  Future<void> login() async {
    if (!developmentLogin) {
      throw Exception('Production phone sign-in is not configured.');
    }
    final data = await request(
      '/auth/dev',
      method: 'POST',
      body: {'user_id': 'farmer-demo'},
    );
    token = data['token'];
    await secure.write(key: 'session', value: token);
    notifyListeners();
    await refresh();
    await sync();
  }

  Future<void> cache(String key, dynamic value) async => db.insert('cache', {
    'key': key,
    'value': jsonEncode(value),
  }, conflictAlgorithm: ConflictAlgorithm.replace);
  Future<dynamic> cached(String key, [dynamic fallback]) async {
    final rows = await db.query('cache', where: 'key=?', whereArgs: [key]);
    return rows.isEmpty
        ? (fallback ?? [])
        : jsonDecode(rows.first['value'] as String);
  }

  Future<void> refresh() async {
    await cache('advice', await request('/advice'));
    await cache('crops', await request('/crops'));
    if (token != null) {
      await cache('fields', await request('/fields'));
      final List list = await request('/cases');
      await cache('cases', list);
      for (final c in list.take(30)) {
        // Only download cases the server has changed since they were cached.
        final Json saved = await cached('case:${c['id']}', <String, dynamic>{});
        if (saved['updated_at'] != c['updated_at']) {
          await cache('case:${c['id']}', await request('/cases/${c['id']}'));
        }
      }
    }
    lastRefresh = DateTime.now();
    notifyListeners();
  }

  Future<String> capture(String source, String crop, String? fieldId) async {
    final key = uuid.v4();
    final dir = await getApplicationDocumentsDirectory();
    final file = await File(source).copy('${dir.path}/$key.jpg');
    final payload = {
      'client_submission_id': key,
      'crop': crop,
      'field_id': fieldId,
      'symptoms': {
        'parts': '',
        'duration': '',
        'insects': '',
        'spread': '',
        'water': '',
      },
      'consent_version': '2026-09-29',
      'training_consent': false,
    };
    await db.insert('drafts', {
      'id': key,
      'payload': jsonEncode(payload),
      'photo': file.path,
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
    notifyListeners();
    return key;
  }

  Future<List<Json>> drafts() async =>
      db.query('drafts', orderBy: 'created_at DESC');
  Future<void> updateDraft(
    String id,
    Json payload, {
    bool ready = false,
  }) async {
    await db.update(
      'drafts',
      {'payload': jsonEncode(payload), 'ready': ready ? 1 : 0, 'retry_at': 0},
      where: 'id=? AND server_id IS NULL',
      whereArgs: [id],
    );
    notifyListeners();
  }

  Future<void> deleteDraft(Json draft) async {
    if (syncing || (draft['server_id'] != null && draft['rejected'] != 1)) {
      throw Exception('This draft is uploading or already submitted.');
    }
    await db.delete('drafts', where: 'id=?', whereArgs: [draft['id']]);
    final file = File(draft['photo']);
    if (await file.exists()) {
      await file.delete();
    }
    notifyListeners();
  }

  Future<void> sync({bool force = false}) async {
    if (syncing || token == null) {
      return;
    }
    syncing = true;
    notifyListeners();
    var changed = false;
    try {
      final rows = await db.query(
        'drafts',
        where: force
            ? 'ready=1 AND rejected=0'
            : 'ready=1 AND rejected=0 AND retry_at<=?',
        whereArgs: force ? null : [DateTime.now().millisecondsSinceEpoch],
      );
      for (final d in rows) {
        try {
          final Json c = await request(
            '/cases',
            method: 'POST',
            body: jsonDecode(d['payload'] as String),
          );
          await db.update(
            'drafts',
            {'server_id': c['id']},
            where: 'id=?',
            whereArgs: [d['id']],
          );
          try {
            await request(
              '/cases/${c['id']}/images',
              method: 'POST',
              image: await File(d['photo'] as String).readAsBytes(),
            );
          } on ApiException catch (e) {
            if (!e.permanent) rethrow;
            // The server will never accept this photo; stop retrying and let the farmer discard it.
            await db.update(
              'drafts',
              {'rejected': 1, 'error': 'Photo not accepted: ${e.message}'},
              where: 'id=?',
              whereArgs: [d['id']],
            );
            status =
                'A photo was not accepted. You can discard it and take a new one.';
            continue;
          }
          await request('/cases/${c['id']}/analysis', method: 'POST');
          await cache('case:${c['id']}', await request('/cases/${c['id']}'));
          await db.delete('drafts', where: 'id=?', whereArgs: [d['id']]);
          final photo = File(d['photo'] as String);
          if (await photo.exists()) {
            await photo.delete();
          }
          status = 'Your crop check is saved online.';
          changed = true;
        } catch (e) {
          final attempts = (d['attempts'] as int) + 1;
          final seconds = (10 * (1 << attempts.clamp(0, 8))).clamp(20, 1800);
          await db.update(
            'drafts',
            {
              'attempts': attempts,
              'error': e.toString(),
              'retry_at':
                  DateTime.now().millisecondsSinceEpoch + seconds * 1000,
            },
            where: 'id=?',
            whereArgs: [d['id']],
          );
          status =
              'Saved on this phone — waiting to upload. ${e.toString().replaceFirst('Exception: ', '')}';
        }
      }
      for (final r in await db.query('reminders', where: 'synced=0')) {
        // Reminders live on the phone; one the server refuses must not block case updates.
        try {
          await request(
            '/reminders',
            method: 'POST',
            body: {
              'client_id': r['id'],
              'title': r['title'],
              'due_at': r['due_at'],
              'completed': r['completed'] == 1,
            },
          );
          await db.update(
            'reminders',
            {'synced': 1},
            where: 'id=?',
            whereArgs: [r['id']],
          );
        } on ApiException catch (e) {
          if (!e.permanent) rethrow;
        }
      }
      if (force ||
          changed ||
          lastRefresh == null ||
          DateTime.now().difference(lastRefresh!) >= refreshInterval) {
        await refresh();
      }
    } catch (_) {
      status =
          'Offline or service unavailable. Your saved work is still on this phone.';
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    db.close();
    super.dispose();
  }
}
