package fmadapter

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestDecodeLineRejectsTrailingMalformedJSON(t *testing.T) {
	encoded, err := EncodeMessage(Message{
		Kind: "request",
		Request: &Request{
			Protocol: Protocol, ProtocolVersion: ProtocolVersion,
			RequestID: "1", Machine: "machine", Generation: 0,
			Operation: Operation{Name: "hello"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, []byte(" trailing")...)
	if _, err := DecodeLine(encoded); err == nil || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("expected trailing-data rejection, got %v", err)
	}
}

func TestDecodeCanonicalRejectsTrailingData(t *testing.T) {
	if _, err := decodeCanonical([]byte(`{} garbage`)); err == nil || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("expected trailing canonical-data rejection, got %v", err)
	}
}

func TestGenerationMustRemainJavaScriptSafe(t *testing.T) {
	valid := Request{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "1", Machine: "machine", Generation: MaxSafeInteger,
		Operation: Operation{Name: "observe"},
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("maximum safe generation rejected: %v", err)
	}
	invalid := valid
	invalid.Generation++
	if err := invalid.Validate(); err == nil || !strings.Contains(err.Error(), "2^53-1") {
		t.Fatalf("expected unsafe generation rejection, got %v", err)
	}
}

func TestLabelsRejectControlCharacters(t *testing.T) {
	request := Request{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "1", Machine: "bad\u0001machine", Generation: 0,
		Operation: Operation{Name: "hello"},
	}
	if err := request.Validate(); err == nil || !strings.Contains(err.Error(), "control") {
		t.Fatalf("expected control-character rejection, got %v", err)
	}
}

func TestOptionalArgumentsCanonicalizeAsExplicitNull(t *testing.T) {
	for _, operation := range []Operation{
		{Name: "apply", Action: "step", LogicalTime: bigint("0")},
		{Name: "fault", Fault: "disconnect"},
	} {
		request := Request{
			Protocol: Protocol, ProtocolVersion: ProtocolVersion,
			RequestID: "1", Machine: "machine", Generation: 0,
			Operation: operation,
		}
		encoded, err := EncodeMessage(Message{Kind: "request", Request: &request})
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(encoded, []byte(`"arguments":null`)) {
			t.Fatalf("missing canonical explicit-null arguments: %s", encoded)
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
			t.Fatalf("canonical bytes drifted: %s != %s", encoded, again)
		}
	}
}

func TestReadBoundedLineRejectsUnterminatedOversizeInput(t *testing.T) {
	input := strings.NewReader(strings.Repeat("x", MaxMessageBytes+2))
	reader := bufio.NewReaderSize(input, 64*1024)
	if _, err := readBoundedLine(reader); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected bounded-line rejection, got %v", err)
	}
}

func TestWriteFullHandlesShortWritesAndZeroProgress(t *testing.T) {
	writer := &oneByteWriter{}
	if err := writeFull(writer, []byte("response\n")); err != nil {
		t.Fatalf("short writes should be drained: %v", err)
	}
	if writer.value.String() != "response\n" {
		t.Fatalf("unexpected short-writer output %q", writer.value.String())
	}
	if err := writeFull(zeroWriter{}, []byte("x")); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("expected io.ErrShortWrite, got %v", err)
	}
}

func TestTranscriptRetainsPendingRequestAfterRejectedResponse(t *testing.T) {
	validator := NewTranscriptValidator()
	request := Request{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "1", Machine: "machine", Generation: 0,
		Operation: Operation{Name: "hello"},
	}
	if err := validator.Accept(Message{Kind: "request", Request: &request}); err != nil {
		t.Fatal(err)
	}
	bad := Response{
		Protocol: Protocol, ProtocolVersion: ProtocolVersion,
		RequestID: "2", Machine: "machine", Generation: 0,
		Operation: "hello", Outcome: OK(validHelloValue()),
	}
	if err := validator.Accept(Message{Kind: "response", Response: &bad}); err == nil {
		t.Fatal("mismatched response unexpectedly accepted")
	}
	good := bad
	good.RequestID = "1"
	if err := validator.Accept(Message{Kind: "response", Response: &good}); err != nil {
		t.Fatalf("valid retry should retain correlation state: %v", err)
	}
}

func TestServeCompletesResponseAcrossShortWrites(t *testing.T) {
	requests := []Request{
		request("1", 0, Operation{Name: "hello"}),
		request("2", 0, Operation{Name: "close"}),
	}
	var input bytes.Buffer
	for index := range requests {
		encoded, err := EncodeMessage(Message{Kind: "request", Request: &requests[index]})
		if err != nil {
			t.Fatal(err)
		}
		input.Write(encoded)
		input.WriteByte('\n')
	}
	writer := &oneByteWriter{}
	if err := Serve(context.Background(), &input, writer, NewLeaseMachine()); err != nil {
		t.Fatal(err)
	}
	if len(splitLines(writer.value.Bytes())) != 2 {
		t.Fatalf("expected two complete response lines, got %q", writer.value.String())
	}
}

func validHelloValue() map[string]any {
	return map[string]any{
		"implementation": map[string]any{
			"language": "go", "name": "test", "version": "1",
		},
		"capabilities": []any{"reset", "apply", "observe", "close"},
		"canonicalStateSchemaHash": "sha256:" + strings.Repeat("0", 64),
	}
}

type oneByteWriter struct{ value bytes.Buffer }

func (writer *oneByteWriter) Write(value []byte) (int, error) {
	if len(value) == 0 {
		return 0, nil
	}
	return writer.value.Write(value[:1])
}

type zeroWriter struct{}

func (zeroWriter) Write([]byte) (int, error) { return 0, nil }
