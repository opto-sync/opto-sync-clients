import 'dart:io';

import 'package:fm_adapter_stream/fm_adapter_capabilities.dart';

void main() {
  stdout.writeln('protocol\t$streamAdapterProtocol');
  stdout.writeln('protocolVersion\t$streamAdapterProtocolVersion');
  stdout.writeln('registry\t${capabilityArrayJsonV1(capabilityRegistryV1())}');
  stdout.writeln(
    'required\t${capabilityArrayJsonV1(requiredCapabilitiesV1())}',
  );
  for (final List<String> sequence in allCanonicalCapabilitySequencesV1()) {
    stdout.writeln('sequence\t${capabilityArrayJsonV1(sequence)}');
  }
}
