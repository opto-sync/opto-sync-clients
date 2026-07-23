import 'dart:ffi';
import 'package:ffi/ffi.dart';

typedef MergeOverrideCbC = Pointer<Utf8> Function(Pointer<Utf8> key, Pointer<Utf8> v1, Pointer<Utf8> v2);
typedef MergeOverrideCbDart = Pointer<Utf8> Function(Pointer<Utf8> key, Pointer<Utf8> v1, Pointer<Utf8> v2);

typedef SyncerMergeJsonC = Pointer<Utf8> Function(Pointer<Utf8> j1, Pointer<Utf8> j2, Pointer<NativeFunction<MergeOverrideCbC>> cb);
typedef SyncerMergeJsonDart = Pointer<Utf8> Function(Pointer<Utf8> j1, Pointer<Utf8> j2, Pointer<NativeFunction<MergeOverrideCbC>> cb);

typedef SyncerFreeC = Void Function(Pointer<Void> ptr);
typedef SyncerFreeDart = void Function(Pointer<Void> ptr);

class Syncer {
  late DynamicLibrary _lib;
  late SyncerMergeJsonDart _mergeJson;
  late SyncerFreeDart _free;

  Syncer(String libPath) {
    _lib = DynamicLibrary.open(libPath);
    _mergeJson = _lib.lookupFunction<SyncerMergeJsonC, SyncerMergeJsonDart>('syncer_merge_json');
    _free = _lib.lookupFunction<SyncerFreeC, SyncerFreeDart>('syncer_free');
  }

  String merge(String j1, String j2, Pointer<NativeFunction<MergeOverrideCbC>> cb) {
    final cj1 = j1.toNativeUtf8();
    final cj2 = j2.toNativeUtf8();

    final resultPtr = _mergeJson(cj1, cj2, cb);

    malloc.free(cj1);
    malloc.free(cj2);

    if (resultPtr == nullptr) return '';

    final result = resultPtr.toDartString();
    _free(resultPtr.cast<Void>());

    return result;
  }
}
