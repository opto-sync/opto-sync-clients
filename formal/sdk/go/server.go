package fmadapter

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math/big"
)

// Adapter is the language-neutral implementation boundary used by Serve.
// Optional operations return an unsupported Outcome rather than writing logs to stdout.
type Adapter interface {
	Hello(context.Context) Outcome
	Reset(context.Context, any, string, any) Outcome
	Apply(context.Context, string, any, any) Outcome
	Observe(context.Context) Outcome
	Settle(context.Context, uint64) Outcome
	Snapshot(context.Context) Outcome
	Restore(context.Context, any, string) Outcome
	Fault(context.Context, string, any) Outcome
	Close(context.Context) Outcome
}

// Serve reads request JSON-lines and writes exactly one response JSON-line per
// request. Protocol errors stop the process boundary; implementation errors are
// returned as structured outcomes.
func Serve(ctx context.Context, input io.Reader, output io.Writer, adapter Adapter) error {
	if adapter == nil {
		return errors.New("adapter is required")
	}
	reader := bufio.NewReaderSize(input, 64*1024)
	lastRequestID := big.NewInt(0)
	generation := uint64(0)
	ready := false
	closed := false
	capabilities := map[string]bool{}

	for {
		line, err := readBoundedLine(reader)
		if errors.Is(err, io.EOF) {
			if closed {
				return nil
			}
			return errors.New("adapter input ended before successful close")
		}
		if err != nil {
			return err
		}
		message, err := DecodeLine(line)
		if err != nil {
			return err
		}
		if message.Kind != "request" || message.Request == nil {
			return errors.New("adapter server accepts request messages only")
		}
		request := *message.Request
		requestID, err := ParseRequestID(request.RequestID)
		if err != nil {
			return err
		}
		if requestID.Cmp(lastRequestID) <= 0 {
			return fmt.Errorf("request id %s must be strictly greater than %s", request.RequestID, lastRequestID.String())
		}
		if closed {
			return errors.New("request received after close")
		}
		operation := request.Operation.Name
		if !ready {
			if operation != "hello" || request.Generation != 0 {
				return errors.New("the first request must be hello at generation 0")
			}
		} else {
			expected := generation
			if operation == "reset" {
				if generation == MaxSafeInteger {
					return errors.New("adapter generation cannot advance beyond 2^53-1")
				}
				expected = generation + 1
			}
			if request.Generation != expected {
				return fmt.Errorf("request %s uses generation %d; expected %d", request.RequestID, request.Generation, expected)
			}
			if operation == "hello" {
				return errors.New("hello may occur only once")
			}
		}

		outcome := dispatch(ctx, adapter, request.Operation)
		if err := outcome.Validate(); err != nil {
			return fmt.Errorf("adapter returned invalid %s outcome: %w", operation, err)
		}
		if ready && operation != "reset" && operation != "close" && !capabilities[operation] && outcome.Kind == "ok" {
			return fmt.Errorf("unadvertised operation %s returned ok", operation)
		}
		if operation == "hello" && outcome.Kind == "ok" {
			hello, err := decodeHelloResult(outcome.Value)
			if err != nil {
				return err
			}
			validatedCapabilities, err := validateCapabilities(hello.Capabilities)
			if err != nil {
				return err
			}
			capabilities = validatedCapabilities
			ready = true
		}
		if operation == "hello" && outcome.Kind != "ok" {
			return errors.New("hello must succeed")
		}
		if operation == "reset" && outcome.Kind == "ok" {
			generation = request.Generation
		}
		if operation == "close" {
			if outcome.Kind != "ok" {
				return errors.New("close must succeed")
			}
			closed = true
		}

		response := Response{
			Protocol: Protocol, ProtocolVersion: ProtocolVersion,
			RequestID: request.RequestID, Machine: request.Machine,
			Generation: request.Generation, Operation: operation, Outcome: outcome,
		}
		encoded, err := EncodeMessage(Message{Kind: "response", Response: &response})
		if err != nil {
			return err
		}
		if len(encoded) > MaxMessageBytes {
			return fmt.Errorf("response exceeds the %d-byte limit", MaxMessageBytes)
		}
		line = append(encoded, '\n')
		if err := writeFull(output, line); err != nil {
			return fmt.Errorf("write adapter response: %w", err)
		}
		lastRequestID = new(big.Int).Set(requestID)
		if closed {
			return nil
		}
	}
}

func dispatch(ctx context.Context, adapter Adapter, operation Operation) Outcome {
	switch operation.Name {
	case "hello":
		return adapter.Hello(ctx)
	case "reset":
		return adapter.Reset(ctx, operation.InitialState, operation.Seed, operation.LogicalTime)
	case "apply":
		return adapter.Apply(ctx, operation.Action, operation.Arguments, operation.LogicalTime)
	case "observe":
		return adapter.Observe(ctx)
	case "settle":
		return adapter.Settle(ctx, operation.MaxSteps)
	case "snapshot":
		return adapter.Snapshot(ctx)
	case "restore":
		return adapter.Restore(ctx, operation.Snapshot, operation.SchemaHash)
	case "fault":
		return adapter.Fault(ctx, operation.Fault, operation.Arguments)
	case "close":
		return adapter.Close(ctx)
	default:
		return ErrorOutcome("unsupported_operation", "operation is not supported", false, map[string]any{"operation": operation.Name})
	}
}

func readBoundedLine(reader *bufio.Reader) ([]byte, error) {
	line := make([]byte, 0, 64*1024)
	for {
		fragment, err := reader.ReadSlice('\n')
		if len(line)+len(fragment) > MaxMessageBytes+1 {
			return nil, fmt.Errorf("stream adapter message exceeds the %d-byte limit", MaxMessageBytes)
		}
		line = append(line, fragment...)
		switch {
		case err == nil:
			return trimLineTerminator(line), nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			if len(line) == 0 {
				return nil, io.EOF
			}
			return trimLineTerminator(line), nil
		default:
			return nil, fmt.Errorf("read adapter request: %w", err)
		}
	}
}

func trimLineTerminator(line []byte) []byte {
	if len(line) > 0 && line[len(line)-1] == '\n' {
		line = line[:len(line)-1]
	}
	if len(line) > 0 && line[len(line)-1] == '\r' {
		line = line[:len(line)-1]
	}
	return line
}

func writeFull(writer io.Writer, value []byte) error {
	for len(value) > 0 {
		written, err := writer.Write(value)
		if written < 0 || written > len(value) {
			return fmt.Errorf("writer returned invalid byte count %d", written)
		}
		value = value[written:]
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func validateCapabilities(values []string) (map[string]bool, error) {
	capabilities := make(map[string]bool, len(values))
	for _, capability := range values {
		if !validOperationName(capability) || capability == "hello" {
			return nil, fmt.Errorf("hello advertised invalid capability %q", capability)
		}
		capabilities[capability] = true
	}
	for _, mandatory := range []string{"reset", "apply", "observe", "close"} {
		if !capabilities[mandatory] {
			return nil, fmt.Errorf("hello result is missing required capability %s", mandatory)
		}
	}
	return capabilities, nil
}

func OK(value any) Outcome {
	return Outcome{Kind: "ok", Value: value}
}

func ErrorOutcome(code, message string, retryable bool, data any) Outcome {
	return Outcome{Kind: "error", Error: &StreamError{Code: code, Message: message, Retryable: retryable, Data: data}}
}

func UnsupportedOutcome(code, message string, data any) Outcome {
	return Outcome{Kind: "unsupported", Error: &StreamError{Code: code, Message: message, Retryable: false, Data: data}}
}
