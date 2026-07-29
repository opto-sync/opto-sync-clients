library formal_itf_replay;

import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show OrderingTerm;
import 'package:drift/native.dart';
import 'package:opto_sync_client/opto_sync_client.dart';

part 'formal_itf_replay/core.dart';
part 'formal_itf_replay/adapter.dart';
part 'formal_itf_replay/projection.dart';
part 'formal_itf_replay/runner.dart';

const _protocol = 'fmctl.adapter.v1';
const _actionField = 'mbt::actionTaken';
const _nondeterministicPicksField = 'mbt::nondetPicks';
const _requiredActions = <String>[
  'init',
  'idle',
  'compact',
  'enqueue',
  'send',
  'apply_new',
  'reject_new',
  'reply_duplicate',
  'inject_mismatched_response',
  'lose_committed_response',
  'lose_uncommitted_request',
  'discard_malformed_response',
  'acknowledge',
  'pull',
  'begin_reset',
  'crash_during_reset',
  'finish_reset',
];

Future<void> main(List<String> arguments) async {
  try {
    if (arguments.isEmpty) {
      await _runProtocol();
    } else {
      await _replayPaths(arguments, protocolMode: false);
    }
  } on Object catch (error, stackTrace) {
    stderr.writeln(error);
    stderr.writeln(stackTrace);
    exitCode = 1;
  }
}
