/// Envelope validation + ingestion, sharing the cross-language contract in
/// `opto-sync-clients/schema/opto-sync-envelope.schema.json`.
///
/// ```dart
/// import 'package:opto_sync_client/schema.dart' as schema;
/// await schema.ingestEnvelope(client, jsonBlob, optimism: rx.Optimism.background);
/// ```
library;

export 'src/schema/ingest.dart';
