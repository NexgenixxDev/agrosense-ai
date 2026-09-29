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
    if (path == '/cases' && method == 'POST') {
      final payload = Map<String, dynamic>.from(body as Map);
      final key = payload['client_submission_id'] as String;
      return server.cases.putIfAbsent(key, () => {'id': key, ...payload});
    }
    if (path.endsWith('/images')) {
      server.uploads.add(path);
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
}
