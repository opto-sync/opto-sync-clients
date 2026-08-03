package fmadapter

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestCapabilityRegistryV1ReturnsDefensiveCopies(t *testing.T) {
	wantRegistry := CapabilityRegistryV1()
	mutatedRegistry := CapabilityRegistryV1()
	mutatedRegistry[0] = "tampered"
	if got := CapabilityRegistryV1(); !equalCapabilitySequence(got, wantRegistry) {
		t.Fatalf("registry accessor leaked mutable storage: want %v, got %v", wantRegistry, got)
	}

	wantRequired := RequiredCapabilitiesV1()
	mutatedRequired := RequiredCapabilitiesV1()
	mutatedRequired[0] = "tampered"
	if got := RequiredCapabilitiesV1(); !equalCapabilitySequence(got, wantRequired) {
		t.Fatalf("required accessor leaked mutable storage: want %v, got %v", wantRequired, got)
	}
}

func TestEveryCanonicalCapabilitySubsetRoundTrips(t *testing.T) {
	registry := CapabilityRegistryV1()
	required := RequiredCapabilitiesV1()
	requiredSet := make(map[string]bool, len(required))
	for _, capability := range required {
		requiredSet[capability] = true
	}

	optional := make([]string, 0, len(registry)-len(required))
	for _, capability := range registry {
		if !requiredSet[capability] {
			optional = append(optional, capability)
		}
	}
	if len(optional) > 20 {
		t.Fatalf("refusing to enumerate %d optional capabilities", len(optional))
	}

	combinations := 1 << uint(len(optional))
	for mask := 0; mask < combinations; mask++ {
		selected := make(map[string]bool, len(registry))
		for _, capability := range required {
			selected[capability] = true
		}
		for index, capability := range optional {
			if mask&(1<<uint(index)) != 0 {
				selected[capability] = true
			}
		}

		expected := make([]string, 0, len(selected))
		for _, capability := range registry {
			if selected[capability] {
				expected = append(expected, capability)
			}
		}
		caseMask := mask
		caseExpected := append([]string(nil), expected...)
		t.Run(fmt.Sprintf("%02d-%s", caseMask, strings.Join(caseExpected, "-")), func(t *testing.T) {
			unordered := append([]string(nil), caseExpected...)
			for left, right := 0, len(unordered)-1; left < right; left, right = left+1, right-1 {
				unordered[left], unordered[right] = unordered[right], unordered[left]
			}
			canonical, err := CanonicalizeCapabilitySetV1(unordered)
			if err != nil {
				t.Fatal(err)
			}
			if !equalCapabilitySequence(canonical, caseExpected) {
				t.Fatalf("canonicalization drift: want %v, got %v", caseExpected, canonical)
			}

			validated, err := validateCapabilities(caseExpected)
			if err != nil {
				t.Fatal(err)
			}
			if len(validated) != len(caseExpected) {
				t.Fatalf("validated set size drift: want %d, got %d", len(caseExpected), len(validated))
			}
			for _, capability := range caseExpected {
				if !validated[capability] {
					t.Fatalf("validated set omitted %q", capability)
				}
			}

			response := Response{
				Protocol: Protocol, ProtocolVersion: ProtocolVersion,
				RequestID: "1", Machine: "lease", Generation: 0,
				Operation: "hello",
				Outcome:   OK(helloValueWithCapabilities(caseExpected)),
			}
			encoded, err := EncodeMessage(Message{Kind: "response", Response: &response})
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := DecodeLine(encoded)
			if err != nil {
				t.Fatal(err)
			}
			again, err := EncodeMessage(decoded)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(encoded, again) {
				t.Fatalf("canonical hello bytes drifted\nfirst %s\nagain %s", encoded, again)
			}
		})
	}
}

func TestEveryMalformedHelloCapabilityClassRetainsPendingState(t *testing.T) {
	for _, test := range malformedCapabilityCases() {
		t.Run(test.name, func(t *testing.T) {
			validator := NewTranscriptValidator()
			helloRequest := request("1", 0, Operation{Name: "hello"})
			if err := validator.Accept(Message{Kind: "request", Request: &helloRequest}); err != nil {
				t.Fatal(err)
			}

			bad := Response{
				Protocol: Protocol, ProtocolVersion: ProtocolVersion,
				RequestID: "1", Machine: "lease", Generation: 0,
				Operation: "hello",
				Outcome:   OK(helloValueWithCapabilities(test.values)),
			}
			if err := validator.Accept(Message{Kind: "response", Response: &bad}); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}

			good := bad
			good.Outcome = OK(helloValueWithCapabilities([]string{"reset", "apply", "observe", "close"}))
			if err := validator.Accept(Message{Kind: "response", Response: &good}); err != nil {
				t.Fatalf("valid retry should preserve pending hello state: %v", err)
			}
		})
	}
}

func TestServeRejectsEveryMalformedHelloBeforeWriting(t *testing.T) {
	helloRequest := request("1", 0, Operation{Name: "hello"})
	encoded, err := EncodeMessage(Message{Kind: "request", Request: &helloRequest})
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range malformedCapabilityCases() {
		t.Run(test.name, func(t *testing.T) {
			inputBytes := append([]byte(nil), encoded...)
			inputBytes = append(inputBytes, '\n')
			input := bytes.NewBuffer(inputBytes)
			var output bytes.Buffer
			adapter := malformedCapabilityHelloAdapter{
				Adapter:      NewLeaseMachine(),
				capabilities: test.values,
			}
			err := Serve(context.Background(), input, &output, adapter)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
			if output.Len() != 0 {
				t.Fatalf("invalid hello must not emit protocol bytes: %q", output.String())
			}
		})
	}
}

type malformedCapabilityCase struct {
	name   string
	values []string
	want   string
}

func malformedCapabilityCases() []malformedCapabilityCase {
	return []malformedCapabilityCase{
		{
			name:   "duplicate",
			values: []string{"reset", "apply", "observe", "observe", "close"},
			want:   "duplicate",
		},
		{
			name:   "missing-required",
			values: []string{"reset", "observe", "close"},
			want:   "missing required",
		},
		{
			name:   "hello-advertised",
			values: []string{"reset", "apply", "observe", "hello", "close"},
			want:   "invalid capability",
		},
		{
			name:   "unknown",
			values: []string{"reset", "apply", "observe", "teleport", "close"},
			want:   "invalid capability",
		},
		{
			name:   "out-of-order",
			values: []string{"reset", "apply", "observe", "snapshot", "settle", "close"},
			want:   "canonical v1 order",
		},
	}
}

type malformedCapabilityHelloAdapter struct {
	Adapter
	capabilities []string
}

func (adapter malformedCapabilityHelloAdapter) Hello(context.Context) Outcome {
	return OK(helloValueWithCapabilities(adapter.capabilities))
}
