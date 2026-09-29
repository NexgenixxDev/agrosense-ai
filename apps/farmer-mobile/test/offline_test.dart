import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:agrosense_farmer/data.dart';

class TestServer {
  final Map<String, Json> cases = {};
  final Set<String> uploads = {};
  final Set<String> jobs = {};
  bool failAfterImage = true;
  bool rejectImage = false;
  bool rejectReminder = false;
  final List<String> log = [];
}

class TestFarm extends FarmData {
  final TestServer server;
  TestFarm(this.server);
  @override
  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Object? body,
    List<int>? image,
  }) async {
    server.log.add('$method $path');
    if (path == '/reminders' && server.rejectReminder) {
      throw const ApiException(
        400,
        'title: String must contain at most 160 character(s)',
      );
    }
    if (path == '/cases' && method == 'POST') {
      final payload = Map<String, dynamic>.from(body as Map);
      final key = payload['client_submission_id'] as String;
      return server.cases.putIfAbsent(key, () => {'id': key, ...payload});
    }
    if (path.endsWith('/images')) {
      server.uploads.add(path);
      if (server.rejectImage) {
        throw const ApiException(
          400,
          'Use a valid JPEG or PNG, at least 224 pixels on each side',
        );
      }
      if (server.failAfterImage) {
        server.failAfterImage = false;
        throw const SocketException(
          'Connection lost after server received image',
        );
      }
      return {'id': 'image'};
    }
    if (path.endsWith('/analysis')) {
      server.jobs.add(path);
      return {'state': 'queued'};
    }
    if (path == '/cases') {
      return server.cases.values.toList();
    }
    if (path.startsWith('/cases/')) {
      return server.cases[path.split('/')[2]];
    }
    return [];
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  test(
    'draft survives restart and ambiguous upload reconnect creates one case and job',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'agrosense-offline-',
      );
      final dbPath = '${directory.path}/drafts.sqlite';
      final photo = await File(
        '${directory.path}/photo.jpg',
      ).writeAsBytes([1, 2, 3]);
      final server = TestServer();
      final first = TestFarm(server);
      await first.init(
        databasePath: dbPath,
        restoreSession: false,
        automaticSync: false,
      );
      first.token = 'test-session';
      final key = uuid.v4();
      await first.db.insert('drafts', {
        'id': key,
        'photo': photo.path,
        'ready': 1,
        'payload': jsonEncode({'client_submission_id': key, 'crop': 'tomato'}),
        'created_at': DateTime.now().toIso8601String(),
      });
      await first.sync(force: true);
      expect((await first.drafts()).length, 1);
      expect(server.cases.length, 1);
      expect(server.jobs, isEmpty);
      await first.db.close();

      final restarted = TestFarm(server);
      await restarted.init(
        databasePath: dbPath,
        restoreSession: false,
        automaticSync: false,
      );
      restarted.token = 'test-session';
      expect((await restarted.drafts()).single['server_id'], key);
      await Future.wait([
        restarted.sync(force: true),
        restarted.sync(force: true),
      ]);
      expect(await restarted.drafts(), isEmpty);
      expect(server.cases.length, 1);
      expect(server.uploads.length, 1);
      expect(server.jobs.length, 1);
      expect((await restarted.cached('cases')).length, 1);
      await restarted.db.close();
      await directory.delete(recursive: true);
    },
  );
  Future<(TestFarm, Directory)> open(TestServer server) async {
    final directory = await Directory.systemTemp.createTemp('agrosense-sync-');
    final farm = TestFarm(server);
    await farm.init(
      databasePath: '${directory.path}/drafts.sqlite',
      restoreSession: false,
      automaticSync: false,
    );
    farm.token = 'test-session';
    return (farm, directory);
  }

  test(
    'background sync with nothing new skips the refresh; unchanged cases are not re-downloaded',
    () async {
      final server = TestServer()..failAfterImage = false;
      server.cases['a'] = {'id': 'a', 'updated_at': '2026-09-29T10:00:00Z'};
      final (farm, directory) = await open(server);
      await farm.sync(force: true);
      expect(server.log.where((r) => r == 'GET /cases/a').length, 1);

      server.log.clear();
      await farm.sync();
      expect(
        server.log,
        isEmpty,
        reason: 'refreshed less than five minutes ago',
      );

      await farm.sync(force: true);
      expect(server.log, contains('GET /cases'));
      expect(
        server.log,
        isNot(contains('GET /cases/a')),
        reason: 'updated_at unchanged',
      );

      server.cases['a'] = {'id': 'a', 'updated_at': '2026-09-29T11:00:00Z'};
      server.log.clear();
      await farm.sync(force: true);
      expect(server.log, contains('GET /cases/a'));
      await farm.db.close();
      await directory.delete(recursive: true);
    },
  );

  test('a reminder the server rejects does not block case updates', () async {
    final server = TestServer()..rejectReminder = true;
    server.cases['a'] = {'id': 'a', 'updated_at': 'v1'};
    final (farm, directory) = await open(server);
    await farm.db.insert('reminders', {
      'id': uuid.v4(),
      'title': 'x' * 200,
      'due_at': DateTime.now().toUtc().toIso8601String(),
    });
    await farm.sync(force: true);
    expect((await farm.cached('cases')).length, 1);
    expect((await farm.db.query('reminders')).single['synced'], 0);
    await farm.db.close();
    await directory.delete(recursive: true);
  });

  test(
    'a photo the server rejects stops retrying and can be discarded',
    () async {
      final server = TestServer()..rejectImage = true;
      final (farm, directory) = await open(server);
      final photo = await File('${directory.path}/small.jpg').writeAsBytes([1]);
      final key = uuid.v4();
      await farm.db.insert('drafts', {
        'id': key,
        'photo': photo.path,
        'ready': 1,
        'payload': jsonEncode({'client_submission_id': key, 'crop': 'tomato'}),
        'created_at': DateTime.now().toIso8601String(),
      });
      await farm.sync(force: true);
      final draft = (await farm.drafts()).single;
      expect(draft['rejected'], 1);
      expect(draft['error'], contains('224 pixels'));
      expect(server.jobs, isEmpty);

      await farm.sync(force: true);
      expect(
        server.uploads.length,
        1,
        reason: 'no retry after a permanent rejection',
      );

      await farm.deleteDraft(draft);
      expect(await farm.drafts(), isEmpty);
      expect(await photo.exists(), isFalse);
      await farm.db.close();
      await directory.delete(recursive: true);
    },
  );

  test('drafts saved before the rejected column existed are upgraded', () async {
    final directory = await Directory.systemTemp.createTemp(
      'agrosense-upgrade-',
    );
    final path = '${directory.path}/old.sqlite';
    final old = await databaseFactory.openDatabase(
      path,
      options: OpenDatabaseOptions(
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
          await d.insert('drafts', {
            'id': 'kept',
            'payload': '{}',
            'photo': 'p',
            'created_at': 'now',
          });
        },
      ),
    );
    await old.close();
    final farm = TestFarm(TestServer());
    await farm.init(
      databasePath: path,
      restoreSession: false,
      automaticSync: false,
    );
    final draft = (await farm.drafts()).single;
    expect(draft['id'], 'kept');
    expect(draft['rejected'], 0);
    await farm.db.close();
    await directory.delete(recursive: true);
  });
}
