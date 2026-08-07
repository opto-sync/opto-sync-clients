import {
  STREAM_ADAPTER_PROTOCOL,
  STREAM_ADAPTER_PROTOCOL_VERSION,
  allCanonicalCapabilitySequencesV1,
  capabilityArrayJsonV1,
  capabilityRegistryV1,
  requiredCapabilitiesV1,
} from './dist/capabilities.js';

console.log(`protocol\t${STREAM_ADAPTER_PROTOCOL}`);
console.log(`protocolVersion\t${STREAM_ADAPTER_PROTOCOL_VERSION}`);
console.log(`registry\t${JSON.stringify(capabilityRegistryV1())}`);
console.log(`required\t${JSON.stringify(requiredCapabilitiesV1())}`);
for (const sequence of allCanonicalCapabilitySequencesV1()) {
  console.log(`sequence\t${capabilityArrayJsonV1(sequence)}`);
}
