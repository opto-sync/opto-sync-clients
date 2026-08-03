export const STREAM_ADAPTER_PROTOCOL = 'fm.adapter.stream.v1' as const;
export const STREAM_ADAPTER_PROTOCOL_VERSION = 1 as const;

const CAPABILITY_REGISTRY_V1 = Object.freeze([
  'reset',
  'apply',
  'observe',
  'settle',
  'snapshot',
  'restore',
  'fault',
  'close',
] as const);

const REQUIRED_CAPABILITIES_V1 = Object.freeze([
  'reset',
  'apply',
  'observe',
  'close',
] as const);

export type StreamCapabilityV1 = (typeof CAPABILITY_REGISTRY_V1)[number];

const registrySet = new Set<string>(CAPABILITY_REGISTRY_V1);

/** Returns a defensive copy of the canonical V1 wire registry. */
export function capabilityRegistryV1(): StreamCapabilityV1[] {
  return [...CAPABILITY_REGISTRY_V1];
}

/** Returns a defensive copy of the mandatory V1 capability set. */
export function requiredCapabilitiesV1(): StreamCapabilityV1[] {
  return [...REQUIRED_CAPABILITIES_V1];
}

/**
 * Validates an unordered application-level capability set and returns the one
 * canonical V1 wire sequence. This function is for producers; received wire
 * arrays must pass validateCapabilitySequenceV1 without repair.
 */
export function canonicalizeCapabilitySetV1(
  values: readonly string[],
): StreamCapabilityV1[] {
  const seen = new Set<string>();
  for (const capability of values) {
    if (capability === 'hello' || !registrySet.has(capability)) {
      throw new Error(
        `hello advertised invalid capability ${JSON.stringify(capability)}`,
      );
    }
    if (seen.has(capability)) {
      throw new Error(
        `hello capabilities contain duplicate ${JSON.stringify(capability)}`,
      );
    }
    seen.add(capability);
  }

  for (const required of REQUIRED_CAPABILITIES_V1) {
    if (!seen.has(required)) {
      throw new Error(
        `hello result is missing required capability ${required}`,
      );
    }
  }

  return CAPABILITY_REGISTRY_V1.filter((capability) => seen.has(capability));
}

/**
 * Validates an incoming wire sequence without silently reordering it.
 * The returned array is a fresh canonical copy suitable for session state.
 */
export function validateCapabilitySequenceV1(
  values: readonly string[],
): StreamCapabilityV1[] {
  const input = [...values];
  const canonical = canonicalizeCapabilitySetV1(input);
  if (
    input.length !== canonical.length ||
    input.some((value, index) => value !== canonical[index])
  ) {
    throw new Error(
      `hello capabilities are not in canonical v1 order: got ${JSON.stringify(input)}; expected ${JSON.stringify(canonical)}`,
    );
  }
  return [...canonical];
}

/** Encodes a validated wire sequence to its exact compact JSON array bytes. */
export function capabilityArrayJsonV1(values: readonly string[]): string {
  return JSON.stringify(validateCapabilitySequenceV1(values));
}

/** Enumerates all 16 valid V1 arrays in deterministic optional-bit order. */
export function allCanonicalCapabilitySequencesV1(): StreamCapabilityV1[][] {
  const required = new Set<string>(REQUIRED_CAPABILITIES_V1);
  const optional = CAPABILITY_REGISTRY_V1.filter(
    (capability) => !required.has(capability),
  );
  const sequences: StreamCapabilityV1[][] = [];
  const combinations = 2 ** optional.length;

  for (let mask = 0; mask < combinations; mask += 1) {
    const selected = new Set<string>(REQUIRED_CAPABILITIES_V1);
    optional.forEach((capability, index) => {
      if (Math.floor(mask / 2 ** index) % 2 === 1) {
        selected.add(capability);
      }
    });
    sequences.push(
      CAPABILITY_REGISTRY_V1.filter((capability) => selected.has(capability)),
    );
  }

  return sequences;
}
