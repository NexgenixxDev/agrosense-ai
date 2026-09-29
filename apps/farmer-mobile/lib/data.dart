import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

const apiBase = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:4100',
);
const developmentLogin = bool.fromEnvironment('DEV_AUTH', defaultValue: false);
const uuid = Uuid();
typedef Json = Map<String, dynamic>;

class FarmData extends ChangeNotifier {
  late Database db;
  String? token;
  bool syncing = false;
  String status = 'Saved work stays available on this phone.';
  final secure = const FlutterSecureStorage();
  Timer? timer;

  Future<void> init({
    String? databasePath,
    bool restoreSession = true,
    bool automaticSync = true,
  }) async {
    final path = databasePath ?? '${await getDatabasesPath()}/agrosense.db';
    db = await openDatabase(
      path,
      version: 1,
      onCreate: (d, v) async {
        await d.execute(
          'CREATE TABLE drafts(id TEXT PRIMARY KEY, payload TEXT NOT NULL, photo TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, server_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL)',
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
      token = await secure.read(key: 'session');
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
    final uri = Uri.parse('$apiBase$path');
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
    final dynamic data = jsonDecode(response.body);
    if (response.statusCode == 401) {
      token = null;
      await secure.delete(key: 'session');
      notifyListeners();
      throw Exception('Please sign in again. Your local drafts are safe.');
    }
    if (response.statusCode >= 400) {
      throw Exception(data['message'] ?? 'Request failed');
    }
    return data;
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
        await cache('case:${c['id']}', await request('/cases/${c['id']}'));
      }
    }
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
    if (syncing || draft['server_id'] != null) {
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
    try {
      final rows = await db.query(
        'drafts',
        where: force ? 'ready=1' : 'ready=1 AND retry_at<=?',
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
          await request(
            '/cases/${c['id']}/images',
            method: 'POST',
            image: await File(d['photo'] as String).readAsBytes(),
          );
          await request('/cases/${c['id']}/analysis', method: 'POST');
          await cache('case:${c['id']}', await request('/cases/${c['id']}'));
          await db.delete('drafts', where: 'id=?', whereArgs: [d['id']]);
          final photo = File(d['photo'] as String);
          if (await photo.exists()) {
            await photo.delete();
          }
          status = 'Your crop check is saved online.';
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
      }
      await refresh();
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
