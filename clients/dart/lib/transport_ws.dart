/// WebSocket transport for the protocol v1 sync loop (native platforms).
///
/// ```dart
/// import 'package:opto_sync_client/transport_ws.dart';
///
/// final transport = WebSocketProtocolTransport(
///   url: 'wss://api.example.com/sync/ws',
///   auth: () async => session.accessToken,   // Supabase / shared-auth
///   onChanged: (_) => loop.hint(),           // realtime pull hint
///   fallback: httpTransport,
/// );
/// ```
library;

export 'src/transport/ws.dart';
