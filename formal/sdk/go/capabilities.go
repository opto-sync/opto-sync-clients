package fmadapter

import "fmt"

var capabilityRegistryV1 = [...]string{
	"reset",
	"apply",
	"observe",
	"settle",
	"snapshot",
	"restore",
	"fault",
	"close",
}

var requiredCapabilitiesV1 = [...]string{
	"reset",
	"apply",
	"observe",
	"close",
}

// CapabilityRegistryV1 returns a defensive copy of the canonical wire order.
// A hello capabilities array must be a subsequence of this registry and contain
// every entry returned by RequiredCapabilitiesV1.
func CapabilityRegistryV1() []string {
	return append([]string(nil), capabilityRegistryV1[:]...)
}

// RequiredCapabilitiesV1 returns the mandatory v1 capability set.
func RequiredCapabilitiesV1() []string {
	return append([]string(nil), requiredCapabilitiesV1[:]...)
}

// CanonicalizeCapabilitySetV1 validates a semantic capability set and returns
// its unique canonical wire sequence. Producers may use this helper to remove
// caller collection-order dependence before constructing a hello result.
func CanonicalizeCapabilitySetV1(values []string) ([]string, error) {
	seen := make(map[string]bool, len(values))
	for _, capability := range values {
		if capability == "hello" || !validOperationName(capability) {
			return nil, fmt.Errorf("hello advertised invalid capability %q", capability)
		}
		if seen[capability] {
			return nil, fmt.Errorf("hello capabilities contain duplicate %q", capability)
		}
		seen[capability] = true
	}
	for _, mandatory := range requiredCapabilitiesV1 {
		if !seen[mandatory] {
			return nil, fmt.Errorf("hello result is missing required capability %s", mandatory)
		}
	}
	canonical := make([]string, 0, len(values))
	for _, capability := range capabilityRegistryV1 {
		if seen[capability] {
			canonical = append(canonical, capability)
		}
	}
	return canonical, nil
}

func equalCapabilitySequence(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
