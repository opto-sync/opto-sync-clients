package fmadapter

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
)

type sessionPhase uint8

const (
	phaseAwaitHello sessionPhase = iota
	phaseReady
	phaseClosed
)

type pendingRequest struct {
	requestID  string
	machine    string
	generation uint64
	operation  string
}

// TranscriptValidator checks request/response correlation, monotonic request IDs,
// reset generations, advertised capabilities, and terminal close semantics.
type TranscriptValidator struct {
	phase         sessionPhase
	generation    uint64
	lastRequestID *big.Int
	pending       *pendingRequest
	capabilities  map[string]bool
}

func NewTranscriptValidator() *TranscriptValidator {
	return &TranscriptValidator{
		phase:         phaseAwaitHello,
		lastRequestID: big.NewInt(0),
		capabilities:  map[string]bool{},
	}
}

func (validator *TranscriptValidator) Accept(message Message) error {
	switch message.Kind {
	case "request":
		if message.Request == nil {
			return errors.New("request envelope lacks request")
		}
		return validator.acceptRequest(*message.Request)
	case "response":
		if message.Response == nil {
			return errors.New("response envelope lacks response")
		}
		return validator.acceptResponse(*message.Response)
	default:
		return fmt.Errorf("unsupported message kind %q", message.Kind)
	}
}

func (validator *TranscriptValidator) Finish() error {
	if validator.pending != nil {
		return fmt.Errorf("transcript ended before response to request %s", validator.pending.requestID)
	}
	if validator.phase != phaseClosed {
		return errors.New("complete transcript must end with a successful close response")
	}
	return nil
}

func (validator *TranscriptValidator) acceptRequest(request Request) error {
	if err := request.Validate(); err != nil {
		return err
	}
	if validator.phase == phaseClosed {
		return errors.New("request received after the session closed")
	}
	if validator.pending != nil {
		return fmt.Errorf("request %s arrived before response to request %s", request.RequestID, validator.pending.requestID)
	}
	requestID, err := ParseRequestID(request.RequestID)
	if err != nil {
		return err
	}
	if requestID.Cmp(validator.lastRequestID) <= 0 {
		return fmt.Errorf("request id %s must be strictly greater than %s", request.RequestID, validator.lastRequestID.String())
	}
	operation := request.Operation.Name
	switch validator.phase {
	case phaseAwaitHello:
		if operation != "hello" || request.Generation != 0 {
			return errors.New("the first request must be hello at generation 0")
		}
	case phaseReady:
		if operation == "hello" {
			return errors.New("hello may only occur before the session is ready")
		}
		expectedGeneration := validator.generation
		if operation == "reset" {
			if validator.generation == MaxSafeInteger {
				return errors.New("adapter generation cannot advance beyond 2^53-1")
			}
			expectedGeneration = validator.generation + 1
		}
		if request.Generation != expectedGeneration {
			return fmt.Errorf("request %s uses generation %d; expected %d", request.RequestID, request.Generation, expectedGeneration)
		}
	}
	validator.lastRequestID = new(big.Int).Set(requestID)
	validator.pending = &pendingRequest{
		requestID: request.RequestID, machine: request.Machine,
		generation: request.Generation, operation: operation,
	}
	return nil
}

func (validator *TranscriptValidator) acceptResponse(response Response) error {
	if err := response.Validate(); err != nil {
		return err
	}
	pending := validator.pending
	if pending == nil {
		return fmt.Errorf("response %s arrived without a pending request", response.RequestID)
	}
	if response.RequestID != pending.requestID || response.Machine != pending.machine || response.Generation != pending.generation || response.Operation != pending.operation {
		return fmt.Errorf(
			"response does not match request %s: got id=%s machine=%s generation=%d operation=%s",
			pending.requestID, response.RequestID, response.Machine, response.Generation, response.Operation,
		)
	}
	if response.Outcome.Kind == "ok" && validator.phase == phaseReady && response.Operation != "reset" && response.Operation != "close" && !validator.capabilities[response.Operation] {
		return fmt.Errorf("unadvertised operation %s returned ok", response.Operation)
	}

	nextPhase := validator.phase
	nextGeneration := validator.generation
	nextCapabilities := validator.capabilities

	switch response.Operation {
	case "hello":
		if response.Outcome.Kind != "ok" {
			return errors.New("hello must succeed")
		}
		hello, err := decodeHelloResult(response.Outcome.Value)
		if err != nil {
			return err
		}
		validatedCapabilities, err := validateCapabilities(hello.Capabilities)
		if err != nil {
			return err
		}
		nextCapabilities = validatedCapabilities
		nextPhase = phaseReady
	case "reset":
		if response.Outcome.Kind == "ok" {
			if validator.generation == MaxSafeInteger {
				return errors.New("adapter generation cannot advance beyond 2^53-1")
			}
			expected := validator.generation + 1
			if response.Generation != expected {
				return fmt.Errorf("successful reset response generation %d does not advance %d by one", response.Generation, validator.generation)
			}
			nextGeneration = response.Generation
		}
	case "close":
		if response.Outcome.Kind != "ok" {
			return errors.New("close must succeed")
		}
		nextPhase = phaseClosed
	}

	validator.phase = nextPhase
	validator.generation = nextGeneration
	validator.capabilities = nextCapabilities
	validator.pending = nil
	return nil
}

func decodeHelloResult(value any) (HelloResult, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return HelloResult{}, fmt.Errorf("encode hello result: %w", err)
	}
	var raw struct {
		Implementation           Implementation `json:"implementation"`
		Capabilities             []string       `json:"capabilities"`
		CanonicalStateSchemaHash string         `json:"canonicalStateSchemaHash"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&raw); err != nil {
		return HelloResult{}, fmt.Errorf("decode hello result: %w", err)
	}
	if err := validateLabel("implementation language", raw.Implementation.Language, 128); err != nil {
		return HelloResult{}, err
	}
	if err := validateLabel("implementation name", raw.Implementation.Name, 256); err != nil {
		return HelloResult{}, err
	}
	if err := validateLabel("implementation version", raw.Implementation.Version, 256); err != nil {
		return HelloResult{}, err
	}
	if err := validateSHA256("canonicalStateSchemaHash", raw.CanonicalStateSchemaHash); err != nil {
		return HelloResult{}, err
	}
	capabilities := append([]string(nil), raw.Capabilities...)
	sort.Strings(capabilities)
	for i := 1; i < len(capabilities); i++ {
		if capabilities[i] == capabilities[i-1] {
			return HelloResult{}, fmt.Errorf("hello capabilities contain duplicate %q", capabilities[i])
		}
	}
	return HelloResult{Implementation: raw.Implementation, Capabilities: raw.Capabilities, CanonicalStateSchemaHash: raw.CanonicalStateSchemaHash}, nil
}
