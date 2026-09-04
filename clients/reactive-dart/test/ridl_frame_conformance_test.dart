import 'dart:convert';
import 'dart:io';

import 'package:opto_sync_reactive/src/ridl_frame.dart';
import 'package:test/test.dart';

/// The frame envelope is a cross-language contract: "Every language port MUST
/// encode `frame` to exactly `encoded` and decode `encoded` back to `frame`."
/// This drives that fixture rather than restating it, so the Dart port cannot
/// drift from Rust, TypeScript or Gleam without failing.
///
/// The fixture lives in ORESoftware/api-docs. Point RIDL_CONFORMANCE at it, or
/// leave the repos checked out side by side.
File? _locateFixture() {
  final fromEnv = Platform.environment['RIDL_CONFORMANCE'];
  final candidates = <String>[
    if (fromEnv != null) fromEnv,
    '../../../../ores/api-docs/examples/frames/conformance.json',
    '../../../../../ores/api-docs/examples/frames/conformance.json',
  ];
  for (final path in candidates) {
    final file = File(path);
    if (file.existsSync()) return file;
  }
  return null;
}

void main() {
  final fixture = _locateFixture();

  group('ridl frame conformance', () {
    if (fixture == null) {
      test('fixture is reachable', () {
        fail(
          'conformance.json not found. Set RIDL_CONFORMANCE to '
          'ORESoftware/api-docs examples/frames/conformance.json',
        );
      });
      return;
    }

    final doc = jsonDecode(fixture.readAsStringSync()) as Map<String, Object?>;
    final cases = (doc['cases'] as List<Object?>).cast<Map<String, Object?>>();

    test('fixture actually loaded some cases', () {
      expect(cases, isNotEmpty);
      expect(doc['frame_version'], kRidlFrameVersion);
    });

    for (final c in cases) {
      final name = c['name'] as String;
      final encoded = c['encoded'] as String;
      final object = c['object'] as Map<String, Object?>;

      test('$name decodes to the documented object', () {
        final frame = RidlFrame.decode(encoded);
        expect(frame.toJson(), equals(object));
      });

      test('$name re-encodes byte-for-byte', () {
        expect(RidlFrame.decode(encoded).encode(), equals(encoded));
      });

      final prefixHex = c['tcp_prefix_hex'] as String?;
      if (prefixHex != null) {
        test('$name carries the documented TCP length prefix', () {
          final framed = RidlFrame.decode(encoded).encodeWithLengthPrefix();
          final prefix = framed
              .sublist(0, 4)
              .map((b) => b.toRadixString(16).padLeft(2, '0'))
              .join();
          expect(prefix, equals(prefixHex));
          // The prefix counts UTF-8 bytes, not characters — the unicode cases
          // are the ones that would catch a length taken from the string.
          expect(framed.length - 4, equals(utf8.encode(encoded).length));
        });
      }
    }
  });

  group('body presence', () {
    // A nullable field alone cannot distinguish "body: null" from "no body";
    // the fixture requires data-null to keep the key and end to omit it.
    test('data keeps an explicit null body', () {
      expect(
        RidlFrame.data(id: '1', body: null).encode(),
        equals('{"v":1,"id":"1","t":"data","body":null}'),
      );
    });

    test('end omits body entirely', () {
      expect(
        RidlFrame.end(id: '1').encode(),
        equals('{"v":1,"id":"1","t":"end"}'),
      );
    });
  });
}
