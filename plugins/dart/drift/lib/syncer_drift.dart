import 'package:drift/drift.dart';
// import 'package:opto_sync_dart/syncer.dart';

class SyncerInterceptor extends QueryInterceptor {
  final String timestampKey;

  SyncerInterceptor({this.timestampKey = 'updated_at'});

  @override
  Future<int> runUpdate(
      QueryExecutor executor, String statement, List<Object?> args) async {
    // Intercept update statement, extract JSON, merge via Dart FFI binding
    return executor.runUpdate(statement, args);
  }
}
