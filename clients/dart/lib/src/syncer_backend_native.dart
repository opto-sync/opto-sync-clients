import 'package:syncer/syncer.dart' as native;

export 'package:syncer/syncer.dart'
    show ArrayMergeStrategy, ArrayStrategy, resolveSyncerLibraryPath;

typedef ArrayMergeStrategy = native.ArrayMergeStrategy;
typedef ArrayStrategy = native.ArrayStrategy;
typedef MergeOptions = native.MergeOptions;
typedef Syncer = native.Syncer;

String resolveSyncerLibraryPath({String directory = '.'}) =>
    native.resolveSyncerLibraryPath(directory: directory);
