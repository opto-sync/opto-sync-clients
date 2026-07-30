import 'dart:io';

import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';
import 'package:opto_sync_client/rx.dart' as rx;
import 'package:opto_sync_client/schema.dart' as schema;
import 'package:test/test.dart';

String locateCoreLibrary() {
  final env = Platform.environment['SYNCER_LIB_PATH'];
  if (env != null && env.isNotEmpty) return env;
  final starts = <String>[
    Directory.current.absolute.path,
    File.fromUri(Platform.script).parent.absolute.path,
  ];
  for (final start in starts) {
    var dir = Directory(start);
    for (var i = 0; i < 10; i++) {
      final buildDir =
          '${dir.path}${Platform.pathSeparator}syncer.c${Platform.pathSeparator}core${Platform.pathSeparator}build';
      if (Directory(buildDir).existsSync()) {
        final path = resolveSyncerLibraryPath(directory: buildDir);
        if (File(path).existsSync()) return path;
      }
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
  }
  throw StateError('could not locate the syncer core library');
}

Directory locateFixtures() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 10; i++) {
    final candidate = Directory(
      '${dir.path}${Platform.pathSeparator}schema${Platform.pathSeparator}fixtures',
    );
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('could not locate schema/fixtures above ${Directory.current.path}');
}

void main() {
  final fixtures = locateFixtures();

  List<File> jsonFiles(String subdir) =>
      Directory('${fixtures.path}${Platform.pathSeparator}$subdir')
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));

  test('accepts every shared valid fixture (cross-language corpus)', () {
    final files = jsonFiles('valid');
    expect(files.length, greaterThanOrEqualTo(3));
    for (final file in files) {
      final envelope = schema.parseEnvelope(file.readAsStringSync());
      expect(envelope.records, isNotEmpty, reason: file.path);
    }
  });

  test('rejects every shared invalid fixture (cross-language corpus)', () {
    final files = jsonFiles('invalid');
    expect(files.length, greaterThanOrEqualTo(4));
    for (final file in files) {
      expect(
        () => schema.parseEnvelope(file.readAsStringSync()),
        throwsA(isA<schema.IngestValidationException>()),
        reason: file.path,
      );
    }
  });

  test('ingestEnvelope queues one mutation per record, in file order', () async {
    final syncer = FfiSyncer(libraryPath: locateCoreLibrary());
    final db = OptoSyncDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final client = OptoSyncClient(db: db, syncer: syncer, stampUpdatedAt: false);

    final raw = File(
      '${fixtures.path}${Platform.pathSeparator}valid${Platform.pathSeparator}nested-keyed-arrays.json',
    ).readAsStringSync();
    final receipts = await schema.ingestEnvelope(
      client,
      raw,
      optimism: rx.Optimism.background,
    );
    expect(receipts, hasLength(2));

    final pending = await client.pendingMutations();
    expect(pending, hasLength(2));
    expect(pending[0].recordId, 'doc-9');
    expect(pending[0].baseRevision, '41');
    expect(pending[1].operation, 'delete');
    expect(pending[1].recordId, 'doc-10');
  });

  test('nothing queues when any record is invalid', () async {
    final syncer = FfiSyncer(libraryPath: locateCoreLibrary());
    final db = OptoSyncDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final client = OptoSyncClient(db: db, syncer: syncer);

    final raw = File(
      '${fixtures.path}${Platform.pathSeparator}invalid${Platform.pathSeparator}missing-updated-at.json',
    ).readAsStringSync();
    await expectLater(
      schema.ingestEnvelope(client, raw),
      throwsA(isA<schema.IngestValidationException>()),
    );
    expect(await client.pendingMutations(), isEmpty);
  });
}
