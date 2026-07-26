/// Array merge strategies shared by native and web merge engines.
enum ArrayMergeStrategy {
  replace(0),
  append(1),
  union(2),
  mergeByIndex(3),
  mergeByKey(4);

  final int value;
  const ArrayMergeStrategy(this.value);
}

typedef ArrayStrategy = ArrayMergeStrategy;

String resolveSyncerLibraryPath({String directory = '.'}) {
  throw UnsupportedError(
    'native syncer library paths are unavailable on this platform; '
    'import package:opto_sync_client/web.dart and use WasmSyncer',
  );
}

class MergeOptions {
  final ArrayMergeStrategy arrayStrategy;
  final int maxDepth;
  final bool detectCircularRefs;
  final bool resolveByTimestamp;
  final String? lwwKeys;
  final String? fwwKeys;
  final String? arrayMatchKeys;

  const MergeOptions({
    this.arrayStrategy = ArrayMergeStrategy.replace,
    this.maxDepth = 0,
    this.detectCircularRefs = false,
    this.resolveByTimestamp = false,
    this.lwwKeys,
    this.fwwKeys,
    this.arrayMatchKeys,
  });
}

class Syncer {
  Syncer(String libraryPath) {
    throw UnsupportedError(
      'FfiSyncer is unavailable on this platform; '
      'import package:opto_sync_client/web.dart and use WasmSyncer',
    );
  }

  String get version => throw UnsupportedError('native syncer is unavailable');

  String? tryMerge(String base, String incoming, {MergeOptions? options}) =>
      throw UnsupportedError('native syncer is unavailable');
}
