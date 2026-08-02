package fmadapter

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestCanonicalJSONNormalizesITFCollections(t *testing.T) {
	input := []byte(`{"z":0,"set":{"#set":[{"#bigint":"2"},{"#bigint":"1"}]},"map":{"#map":[[{"#bigint":"2"},"b"],[{"#bigint":"1"},"a"]]}}`)
	actual, err := CanonicalJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"map":{"#map":[[{"#bigint":"1"},"a"],[{"#bigint":"2"},"b"]]},"set":{"#set":[{"#bigint":"1"},{"#bigint":"2"}]},"z":0}`
	if string(actual) != expected {
		t.Fatalf("canonical JSON\nwant %s\n got %s", expected, actual)
	}
	again, err := CanonicalJSON(actual)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, again) {
		t.Fatalf("canonicalization is not idempotent: %s != %s", actual, again)
	}
}

func TestCanonicalJSONRejectsAmbiguity(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"float", `1.5`, "floating-point"},
		{"duplicate set", `{"#set":[1,1]}`, "duplicate canonical"},
		{"duplicate map", `{"#map":[[1,"a"],[1,"b"]]}`, "duplicate canonical"},
		{"noncanonical bigint", `{"#bigint":"01"}`, "leading zeroes"},
		{"oversized ordinary integer", `18446744073709551616`, "encode it as #bigint"},
		{"trailing value", `{} {}`, "more than one"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := CanonicalJSON([]byte(test.input))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestSharedGoldenTranscripts(t *testing.T) {
	valid := []string{"valid/happy.jsonl", "valid/unsupported.jsonl"}
	for _, name := range valid {
		t.Run(name, func(t *testing.T) {
			validator := NewTranscriptValidator()
			if err := walkFixture(name, func(message Message) error { return validator.Accept(message) }); err != nil {
				t.Fatal(err)
			}
			if err := validator.Finish(); err != nil {
				t.Fatal(err)
			}
		})
	}

	invalid := []struct {
		name string
		want string
	}{
		{"invalid/duplicate-request-id.jsonl", "strictly greater"},
		{"invalid/stale-generation.jsonl", "expected 1"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			validator := NewTranscriptValidator()
			err := walkFixture(test.name, func(message Message) error { return validator.Accept(message) })
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestLeaseReferenceServerIsDeterministic(t *testing.T) {
	requests := []Request{
		request("1", 0, Operation{Name: "hello"}),
		request("2", 1, Operation{Name: "reset", InitialState: map[string]any{}, LogicalTime: bigint("0")}),
		request("3", 1, Operation{Name: "apply", Action: "acquire", Arguments: map[string]any{"resource": "r", "owner": "alice", "request": "a", "ttl": bigint("10")}, LogicalTime: bigint("0")}),
		request("4", 1, Operation{Name: "apply", Action: "acquire", Arguments: map[string]any{"resource": "r", "owner": "alice", "request": "a", "ttl": bigint("10")}, LogicalTime: bigint("1")}),
		request("5", 1, Operation{Name: "apply", Action: "cancel", Arguments: map[string]any{"request": "a"}, LogicalTime: bigint("1")}),
		request("6", 1, Operation{Name: "apply", Action: "advance_time", Arguments: map[string]any{}, LogicalTime: bigint("10")}),
		request("7", 1, Operation{Name: "apply", Action: "acquire", Arguments: map[string]any{"resource": "r", "owner": "bob", "request": "b", "ttl": bigint("5")}, LogicalTime: bigint("10")}),
		request("8", 1, Operation{Name: "snapshot"}),
		request("9", 1, Operation{Name: "close"}),
	}

	var input bytes.Buffer
	requestLines := make([][]byte, 0, len(requests))
	for i := range requests {
		encoded, err := EncodeMessage(Message{Kind: "request", Request: &requests[i]})
		if err != nil {
			t.Fatal(err)
		}
		requestLines = append(requestLines, encoded)
		input.Write(encoded)
		input.WriteByte('\n')
	}

	var output bytes.Buffer
	if err := Serve(context.Background(), &input, &output, NewLeaseMachine()); err != nil {
		t.Fatal(err)
	}
	responseLines := splitLines(output.Bytes())
	if len(responseLines) != len(requestLines) {
		t.Fatalf("expected %d responses, got %d", len(requestLines), len(responseLines))
	}
	validator := NewTranscriptValidator()
	var seventh Response
	for i := range requestLines {
		requestMessage, err := DecodeLine(requestLines[i])
		if err != nil {
			t.Fatal(err)
		}
		if err := validator.Accept(requestMessage); err != nil {
			t.Fatal(err)
		}
		responseMessage, err := DecodeLine(responseLines[i])
		if err != nil {
			t.Fatal(err)
		}
		if err := validator.Accept(responseMessage); err != nil {
			t.Fatal(err)
		}
		if i == 6 {
			seventh = *responseMessage.Response
		}
	}
	if err := validator.Finish(); err != nil {
		t.Fatal(err)
	}

	encoded, err := json.Marshal(seventh.Outcome.Value)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"#bigint":"2"`)) {
		t.Fatalf("expected second fencing token after expiry, got %s", encoded)
	}
}

func TestDecodeLineRejectsOversizedFrames(t *testing.T) {
	line := bytes.Repeat([]byte{'x'}, MaxMessageBytes+1)
	if _, err := DecodeLine(line); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected size error, got %v", err)
	}
}

func FuzzCanonicalJSON(f *testing.F) {
	for _, seed := range []string{`null`, `{"#bigint":"0"}`, `{"#set":[]}`, `{"#map":[]}`, `{"a":[1,true,"x"]}`} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		first, err := CanonicalJSON([]byte(input))
		if err != nil {
			return
		}
		second, err := CanonicalJSON(first)
		if err != nil {
			t.Fatalf("canonical output rejected: %v", err)
		}
		if !bytes.Equal(first, second) {
			t.Fatalf("not idempotent: %q != %q", first, second)
		}
	})
}

func walkFixture(name string, accept func(Message) error) error {
	path := filepath.Join("..", "..", "protocol-fixtures", "stream", filepath.FromSlash(name))
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), MaxMessageBytes)
	line := 0
	for scanner.Scan() {
		line++
		message, err := DecodeLine(scanner.Bytes())
		if err != nil {
			return &fixtureError{name: name, line: line, err: err}
		}
		if err := accept(message); err != nil {
			return &fixtureError{name: name, line: line, err: err}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return nil
}

type fixtureError struct {
	name string
	line int
	err  error
}

func (err *fixtureError) Error() string {
	return err.name + ":" + strconv.Itoa(err.line) + ": " + err.err.Error()
}
func (err *fixtureError) Unwrap() error { return err.err }

func request(id string, generation uint64, operation Operation) Request {
	return Request{Protocol: Protocol, ProtocolVersion: ProtocolVersion, RequestID: id, Machine: "lease", Generation: generation, Operation: operation}
}
func bigint(value string) any { return map[string]any{"#bigint": value} }
func splitLines(value []byte) [][]byte {
	raw := bytes.Split(bytes.TrimSpace(value), []byte{'\n'})
	result := make([][]byte, 0, len(raw))
	for _, line := range raw {
		if len(line) > 0 {
			result = append(result, line)
		}
	}
	return result
}
