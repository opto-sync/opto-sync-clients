package fmadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCapabilityRegistryMatchesSharedFixture(t *testing.T) {
	path := filepath.Join("..", "..", "protocol-fixtures", "stream", "capabilities.v1.json")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Protocol        string   `json:"protocol"`
		ProtocolVersion int      `json:"protocolVersion"`
		WireRule        string   `json:"wireRule"`
		Registry        []string `json:"registry"`
		Required        []string `json:"required"`
	}
	if err := json.Unmarshal(source, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Protocol != Protocol || fixture.ProtocolVersion != ProtocolVersion {
		t.Fatalf("unexpected registry protocol identity: %+v", fixture)
	}
	if fixture.WireRule != "strict-subsequence" {
		t.Fatalf("unexpected capability wire rule %q", fixture.WireRule)
	}
	if !equalCapabilitySequence(fixture.Registry, CapabilityRegistryV1()) {
		t.Fatalf("registry drift: fixture=%v go=%v", fixture.Registry, CapabilityRegistryV1())
	}
	if !equalCapabilitySequence(fixture.Required, RequiredCapabilitiesV1()) {
		t.Fatalf("required capability drift: fixture=%v go=%v", fixture.Required, RequiredCapabilitiesV1())
	}
}

func TestCanonicalizeCapabilitySetV1RemovesCallerOrderDependence(t *testing.T) {
	actual, err := CanonicalizeCapabilitySetV1([]string{
		"close", "fault", "observe", "reset", "snapshot", "apply",
	})
	if err != nil {
		t.Fatal(err)
	}
	expected := []string{"reset", "apply", "observe", "snapshot", "fault", "close"}
	if !equalCapabilitySequence(actual, expected) {
		t.Fatalf("canonical order\nwant %v\n got %v", expected, actual)
	}
}

func TestValidateCapabilitiesRejectsMalformedWireSequences(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		want   string
	}{
		{"duplicate", []string{"reset", "apply", "observe", "observe", "close"}, "duplicate"},
		{"missing required", []string{"reset", "observe", "close"}, "missing required"},
		{"hello advertised", []string{"reset", "apply", "observe", "hello", "close"}, "invalid capability"},
		{"unknown", []string{"reset", "apply", "observe", "teleport", "close"}, "invalid capability"},
		{"out of order", []string{"reset", "apply", "observe", "snapshot", "settle", "close"}, "canonical v1 order"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateCapabilities(test.values)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestSharedCapabilityTranscripts(t *testing.T) {
	validator := NewTranscriptValidator()
	if err := walkFixture("valid/minimal-capabilities.jsonl", func(message Message) error {
		return validator.Accept(message)
	}); err != nil {
		t.Fatal(err)
	}
	if err := validator.Finish(); err != nil {
		t.Fatal(err)
	}

	invalid := []struct {
		name string
		want string
	}{
		{"invalid/duplicate-capability.jsonl", "duplicate"},
		{"invalid/missing-required-capability.jsonl", "missing required"},
		{"invalid/hello-capability.jsonl", "invalid capability"},
		{"invalid/unknown-capability.jsonl", "invalid capability"},
		{"invalid/out-of-order-capability.jsonl", "canonical v1 order"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			validator := NewTranscriptValidator()
			err := walkFixture(test.name, func(message Message) error {
				return validator.Accept(message)
			})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestRejectedHelloCapabilitiesLeaveCorrelationStateUntouched(t *testing.T) {
	validator := NewTranscriptValidator()
	helloRequest := request("1", 0, Operation{Name: "hello"})
	if err := validator.Accept(Message{Kind: "request", Request: &helloRequest}); err != nil {
		t.Fatal(err)
	}
	bad := Response{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "1", Machine: "lease", Generation: 0,
		Operation: "hello",
		Outcome: OK(helloValueWithCapabilities([]string{
			"reset", "apply", "observe", "snapshot", "settle", "close",
		})),
	}
	if err := validator.Accept(Message{Kind: "response", Response: &bad}); err == nil || !strings.Contains(err.Error(), "canonical") {
		t.Fatalf("expected noncanonical hello rejection, got %v", err)
	}
	good := bad
	good.Outcome = OK(helloValueWithCapabilities([]string{"reset", "apply", "observe", "close"}))
	if err := validator.Accept(Message{Kind: "response", Response: &good}); err != nil {
		t.Fatalf("valid retry should preserve pending hello state: %v", err)
	}
}

func TestServeRejectsNoncanonicalHelloBeforeWriting(t *testing.T) {
	helloRequest := request("1", 0, Operation{Name: "hello"})
	encoded, err := EncodeMessage(Message{Kind: "request", Request: &helloRequest})
	if err != nil {
		t.Fatal(err)
	}
	input := bytes.NewBuffer(append(encoded, '\n'))
	var output bytes.Buffer
	adapter := nonCanonicalHelloAdapter{Adapter: NewLeaseMachine()}
	err = Serve(context.Background(), input, &output, adapter)
	if err == nil || !strings.Contains(err.Error(), "canonical v1 order") {
		t.Fatalf("expected canonical capability rejection, got %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("invalid hello must not emit protocol bytes: %q", output.String())
	}
}

func TestCanonicalHelloBytesRoundTrip(t *testing.T) {
	response := Response{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "1", Machine: "lease", Generation: 0,
		Operation: "hello",
		Outcome: OK(helloValueWithCapabilities(CapabilityRegistryV1())),
	}
	encoded, err := EncodeMessage(Message{Kind: "response", Response: &response})
	if err != nil {
		t.Fatal(err)
	}
	want := []byte(`"capabilities":["reset","apply","observe","settle","snapshot","restore","fault","close"]`)
	if !bytes.Contains(encoded, want) {
		t.Fatalf("canonical capability bytes missing: %s", encoded)
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
		t.Fatalf("hello bytes drifted\nfirst %s\nagain %s", encoded, again)
	}
}

func helloValueWithCapabilities(capabilities []string) map[string]any {
	values := make([]any, len(capabilities))
	for index, capability := range capabilities {
		values[index] = capability
	}
	return map[string]any{
		"implementation": map[string]any{
			"language": "go", "name": "capability-test", "version": "1",
		},
		"capabilities":             values,
		"canonicalStateSchemaHash": "sha256:" + strings.Repeat("0", 64),
	}
}

type nonCanonicalHelloAdapter struct{ Adapter }

func (nonCanonicalHelloAdapter) Hello(context.Context) Outcome {
	return OK(helloValueWithCapabilities([]string{
		"reset", "apply", "observe", "snapshot", "settle", "close",
	}))
}
