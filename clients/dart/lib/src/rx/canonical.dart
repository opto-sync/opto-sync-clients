import 'dart:convert';

/// Canonical JSON encoding: object keys sorted recursively, then encoded.
///
/// Two JSON values that differ only in key order produce the same string, so
/// this is the structural-equality key the reactive layer's `distinct()` uses.
/// It deliberately does nothing cleverer — no number normalization, no
/// whitespace policy beyond [jsonEncode]'s — because both sides of every
/// comparison here were produced by [jsonEncode] in the first place.
String canonicalJson(Object? value) => jsonEncode(_canonicalize(value));

/// Structural equality on canonical JSON form.
bool canonicalJsonEquals(Object? a, Object? b) =>
    canonicalJson(a) == canonicalJson(b);

Object? _canonicalize(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((key) => key as String).toList()..sort();
    return {for (final key in keys) key: _canonicalize(value[key])};
  }
  if (value is List) {
    return [for (final item in value) _canonicalize(item)];
  }
  return value;
}
