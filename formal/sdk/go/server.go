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
				expected++
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
			capabilities = map[string]bool{}
			for _, capability := range hello.Capabilities {
				capabilities[capability] = true
			}
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
		if _, err := output.Write(append(encoded, '\n')); err != nil {
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
	line, err := reader.ReadBytes('\n')
	if len(line) > MaxMessageBytes+1 {
		return nil, fmt.Errorf("stream adapter message exceeds the %d-byte limit", MaxMessageBytes)
	}
	if len(line) > 0 && line[len(line)-1] == '\n' {
		line = line[:len(line)-1]
	}
	if len(line) > 0 && line[len(line)-1] == '\r' {
		line = line[:len(line)-1]
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("read adapter request: %w", err)
	}
	if errors.Is(err, io.EOF) && len(line) == 0 {
		return nil, io.EOF
	}
	return line, nil
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
