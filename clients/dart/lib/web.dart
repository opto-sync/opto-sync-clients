/// Browser entry point for opto_sync_client.
///
/// Queue state is a SQLite database running in WebAssembly and persisted
/// explicitly in IndexedDB. Reconciliation uses the same syncer.c core through
/// the self-contained WebAssembly module shipped by `@opto-sync/syncer-wasm`.
library;

import 'dart:js_interop';

import 'package:drift/wasm.dart';

import 'opto_sync_client.dart';

export 'opto_sync_client.dart';

extension type _SyncerModule._(JSObject _) implements JSObject {
  external JSPromise<JSAny?> initSyncer();
  external JSString? mergeJson(
    JSString base,
    JSString incoming, [
    JSObject? options,
  ]);
  external JSString version();
}

/// syncer.c merge engine loaded through the browser WebAssembly binding.
///
/// Construct with [WasmSyncer.load]. The module URI should point at the
/// self-contained `syncer-core.single.mjs` entry point (or another module with
/// the `@opto-sync/syncer-wasm` API).
final class WasmSyncer implements TimestampConfiguredSyncer {
  final _SyncerModule _module;

  final bool resolveByTimestamp;
  @override
  final String? lwwKeys;
  final String? fwwKeys;
  final ArrayMergeStrategy arrayStrategy;
  final String? arrayMatchKeys;
  final int maxDepth;
  final bool detectCircularRefs;

  WasmSyncer._(
    this._module, {
    required this.resolveByTimestamp,
    required this.lwwKeys,
    required this.fwwKeys,
    required this.arrayStrategy,
    required this.arrayMatchKeys,
    required this.maxDepth,
    required this.detectCircularRefs,
  });

  static Future<WasmSyncer> load({
    required Uri moduleUri,
    bool resolveByTimestamp = true,
    String? lwwKeys = 'updatedAt,syncedAt',
    String? fwwKeys,
    ArrayMergeStrategy arrayStrategy = ArrayMergeStrategy.mergeByKey,
    String? arrayMatchKeys = 'id',
    int maxDepth = 0,
    bool detectCircularRefs = false,
  }) async {
    if (maxDepth < 0 || maxDepth > 0xffffffff) {
      throw RangeError.range(maxDepth, 0, 0xffffffff, 'maxDepth');
    }
    final imported = await importModule(moduleUri.toString().toJS).toDart;
    final module = _SyncerModule._(imported);
    await module.initSyncer().toDart;
    return WasmSyncer._(
      module,
      resolveByTimestamp: resolveByTimestamp,
      lwwKeys: lwwKeys,
      fwwKeys: fwwKeys,
      arrayStrategy: arrayStrategy,
      arrayMatchKeys: arrayMatchKeys,
      maxDepth: maxDepth,
      detectCircularRefs: detectCircularRefs,
    );
  }

  String get wasmVersion => _module.version().toDart;

  WasmSyncer overlay() => WasmSyncer._(
    _module,
    resolveByTimestamp: false,
    lwwKeys: lwwKeys,
    fwwKeys: fwwKeys,
    arrayStrategy: arrayStrategy,
    arrayMatchKeys: arrayMatchKeys,
    maxDepth: maxDepth,
    detectCircularRefs: detectCircularRefs,
  );

  @override
  String merge(String base, String incoming) {
    if (base.contains('\u0000') || incoming.contains('\u0000')) {
      throw SyncerMergeException('WebAssembly merge rejected an interior NUL');
    }
    final options =
        <String, Object?>{
              'resolveByTimestamp': resolveByTimestamp,
              'arrayStrategy': arrayStrategy.value,
              'maxDepth': maxDepth,
              'detectCircularRefs': detectCircularRefs,
              if (lwwKeys != null) 'lwwKeys': lwwKeys,
              if (fwwKeys != null) 'fwwKeys': fwwKeys,
              if (arrayMatchKeys != null) 'arrayMatchKeys': arrayMatchKeys,
            }.jsify()
            as JSObject;
    final result = _module.mergeJson(base.toJS, incoming.toJS, options);
    if (result == null) {
      throw SyncerMergeException(
        'WebAssembly merge failed (invalid JSON input?): '
        'base=$base incoming=$incoming',
      );
    }
    return result.toDart;
  }
}

/// Opened browser queue and the exact Drift storage selected for it.
final class OptoSyncWebDatabase {
  final OptoSyncDatabase database;
  final WasmStorageImplementation storage;
  final Set<MissingBrowserFeature> missingFeatures;

  const OptoSyncWebDatabase(this.database, this.storage, this.missingFeatures);

  Future<void> close() => database.close();
}

/// Opens the Dart queue on browser IndexedDB.
///
/// This deliberately refuses OPFS and in-memory fallbacks. The user-visible
/// contract is IndexedDB durability, so unsupported browsers fail closed.
/// [sqlite3Uri] and [driftWorkerUri] are the two standard Drift web assets.
Future<OptoSyncWebDatabase> openOptoSyncIndexedDb({
  required String databaseName,
  required Uri sqlite3Uri,
  required Uri driftWorkerUri,
}) async {
  final probe = await WasmDatabase.probe(
    sqlite3Uri: sqlite3Uri,
    driftWorkerUri: driftWorkerUri,
    databaseName: databaseName,
  );
  final storage =
      probe.availableStorages.contains(
        WasmStorageImplementation.sharedIndexedDb,
      )
      ? WasmStorageImplementation.sharedIndexedDb
      : probe.availableStorages.contains(
          WasmStorageImplementation.unsafeIndexedDb,
        )
      ? WasmStorageImplementation.unsafeIndexedDb
      : throw UnsupportedError(
          'IndexedDB persistence is unavailable: ${probe.missingFeatures}',
        );
  final connection = await probe.open(storage, databaseName);
  return OptoSyncWebDatabase(
    OptoSyncDatabase(connection),
    storage,
    Set.unmodifiable(probe.missingFeatures),
  );
}
