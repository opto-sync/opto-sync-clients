import 'dart:convert';
import 'dart:typed_data';

/// Codec for the ridl RPC frame envelope (`rpc-frame.schema.json`, v2 stack).
///
/// HTTP does not use this envelope — an HTTP request already carries method,
/// path, query and body. WebSocket and TCP have no such structure, so a call is
/// framed explicitly, and every language port MUST encode a frame to exactly
/// the same bytes. `examples/frames/conformance.json` in ORESoftware/api-docs
/// is the fixture; [RidlFrame.encode] is written to satisfy it byte-for-byte:
///
///   * compact JSON — `,` and `:` separators, no spaces
///   * raw UTF-8 for non-ASCII, never `\u` escapes ("café", not "café")
///   * fixed key order: v, id, t, key, method, path, query, body, code, message, meta
///   * TCP length prefix is the UTF-8 *byte* length, big-endian uint32
///
/// Dart's Map preserves insertion order and jsonEncode leaves non-ASCII
/// unescaped, so building the map in order and encoding it satisfies all four.
///
/// Do not send a v1 `rpc-call` object as a v2 frame; they are separate stacks.
enum RidlFrameType {
  /// Opens an exchange.
  call('call'),

  /// Carries one payload. Zero or more per exchange.
  data('data'),

  /// Closes a successful exchange.
  end('end'),

  /// Closes a failed exchange.
  error('error'),

  /// Abandons an exchange, from either side.
  cancel('cancel');

  const RidlFrameType(this.wire);

  final String wire;

  static RidlFrameType fromWire(String wire) {
    for (final value in values) {
      if (value.wire == wire) return value;
    }
    throw FormatException('not a ridl frame type: $wire');
  }
}

/// Version of the frame envelope itself, not of any service.
const int kRidlFrameVersion = 1;

/// The order keys must appear in for byte-for-byte conformance.
const List<String> _keyOrder = <String>[
  'v', 'id', 't', 'key', 'method', 'path', 'query', 'body', 'code', 'message', 'meta',
];

class RidlFrame {
  const RidlFrame({
    required this.id,
    required this.type,
    this.key,
    this.method,
    this.path,
    this.query,
    this.body,
    this.hasBody = false,
    this.code,
    this.message,
    this.meta,
    this.version = kRidlFrameVersion,
  });

  /// Opens an exchange.
  factory RidlFrame.call({
    required String id,
    required String key,
    required String method,
    required String path,
    List<List<String>>? query,
    Object? body,
    bool hasBody = false,
    Map<String, Object?>? meta,
  }) =>
      RidlFrame(
        id: id,
        type: RidlFrameType.call,
        key: key,
        method: method,
        path: path,
        query: query,
        body: body,
        hasBody: hasBody || body != null,
        meta: meta,
      );

  /// One payload. `body` is nullable *and* always present, so it is written
  /// even when null — `data-null` in the fixture is `{"v":1,"id":"1","t":"data","body":null}`.
  factory RidlFrame.data({required String id, required Object? body}) =>
      RidlFrame(id: id, type: RidlFrameType.data, body: body, hasBody: true);

  factory RidlFrame.end({required String id}) =>
      RidlFrame(id: id, type: RidlFrameType.end);

  factory RidlFrame.error({
    required String id,
    required String code,
    String? message,
  }) =>
      RidlFrame(id: id, type: RidlFrameType.error, code: code, message: message);

  factory RidlFrame.cancel({required String id}) =>
      RidlFrame(id: id, type: RidlFrameType.cancel);

  final int version;
  final String id;
  final RidlFrameType type;
  final String? key;
  final String? method;
  final String? path;
  final List<List<String>>? query;
  final Object? body;

  /// Distinguishes "body: null" (must be written) from "no body" (must be
  /// omitted). A nullable field alone cannot express that difference.
  final bool hasBody;
  final String? code;
  final String? message;
  final Map<String, Object?>? meta;

  Map<String, Object?> toJson() {
    // Insertion order here IS the wire order; do not reorder these writes.
    // Written as plain sequential statements rather than a switch so the
    // ordering is visible in one glance and cannot drift from _keyOrder.
    final out = <String, Object?>{};
    out['v'] = version;
    out['id'] = id;
    out['t'] = type.wire;
    if (key != null) out['key'] = key;
    if (method != null) out['method'] = method;
    if (path != null) out['path'] = path;
    if (query != null) out['query'] = query;
    if (hasBody) out['body'] = body;
    if (code != null) out['code'] = code;
    if (message != null) out['message'] = message;
    if (meta != null) out['meta'] = meta;
    assert(
      _keyOrder.length >= out.length &&
          out.keys.every(_keyOrder.contains) &&
          _isOrdered(out.keys.toList(growable: false)),
      'frame key order drifted from the conformance order',
    );
    return out;
  }

  static bool _isOrdered(List<String> keys) {
    var previous = -1;
    for (final k in keys) {
      final index = _keyOrder.indexOf(k);
      if (index <= previous) return false;
      previous = index;
    }
    return true;
  }

  /// The exact wire string. `jsonEncode` emits compact JSON and leaves
  /// non-ASCII unescaped, which is what the fixture requires.
  String encode() => jsonEncode(toJson());

  /// UTF-8 bytes of [encode], for a WebSocket binary frame or TCP payload.
  Uint8List encodeBytes() => Uint8List.fromList(utf8.encode(encode()));

  /// TCP framing: big-endian uint32 UTF-8 byte length, then the payload.
  Uint8List encodeWithLengthPrefix() {
    final payload = encodeBytes();
    final out = BytesBuilder(copy: false)
      ..add((ByteData(4)..setUint32(0, payload.length, Endian.big)).buffer.asUint8List())
      ..add(payload);
    return out.takeBytes();
  }

  static RidlFrame decode(String wire) => fromJson(
        jsonDecode(wire) as Map<String, Object?>,
      );

  static RidlFrame fromJson(Map<String, Object?> json) {
    final rawType = json['t'];
    if (rawType is! String) {
      throw const FormatException('ridl frame: missing "t"');
    }
    final rawId = json['id'];
    if (rawId is! String) {
      throw const FormatException('ridl frame: missing "id"');
    }
    final rawQuery = json['query'];
    return RidlFrame(
      version: (json['v'] as int?) ?? kRidlFrameVersion,
      id: rawId,
      type: RidlFrameType.fromWire(rawType),
      key: json['key'] as String?,
      method: json['method'] as String?,
      path: json['path'] as String?,
      query: rawQuery == null
          ? null
          : (rawQuery as List<Object?>)
              .map((pair) =>
                  (pair as List<Object?>).map((e) => e as String).toList(growable: false))
              .toList(growable: false),
      body: json['body'],
      hasBody: json.containsKey('body'),
      code: json['code'] as String?,
      message: json['message'] as String?,
      meta: json['meta'] as Map<String, Object?>?,
    );
  }

  @override
  String toString() => 'RidlFrame(${encode()})';
}
