package fmadapter

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
)

const (
	Protocol               = "fm.adapter.stream.v1"
	ProtocolVersion        = 1
	MaxMessageBytes        = 1024 * 1024
	MaxSettleSteps  uint64 = 1_000_000
)

var maxRequestID = mustBigInt("9007199254740991")

func mustBigInt(value string) *big.Int {
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		panic("invalid constant bigint")
	}
	return parsed
}

type Message struct {
	Kind     string
	Request  *Request
	Response *Response
}

type Request struct {
	Protocol        string
	ProtocolVersion int
	RequestID       string
	Machine         string
	Generation      uint64
	Operation       Operation
}

type Operation struct {
	Name         string
	InitialState any
	Seed         string
	LogicalTime  any
	Action       string
	Arguments    any
	MaxSteps     uint64
	Snapshot     any
	SchemaHash   string
	Fault        string
}

type Response struct {
	Protocol        string
	ProtocolVersion int
	RequestID       string
	Machine         string
	Generation      uint64
	Operation       string
	Outcome         Outcome
}

type Outcome struct {
	Kind  string
	Value any
	Error *StreamError
}

type StreamError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
	Data      any    `json:"data,omitempty"`
}

type Implementation struct {
	Language string `json:"language"`
	Name     string `json:"name"`
	Version  string `json:"version"`
}

type HelloResult struct {
	Implementation           Implementation `json:"implementation"`
	Capabilities             []string       `json:"capabilities"`
	CanonicalStateSchemaHash string         `json:"canonicalStateSchemaHash"`
}

func DecodeLine(line []byte) (Message, error) {
	if len(line) > MaxMessageBytes {
		return Message{}, fmt.Errorf("stream adapter message exceeds the %d-byte limit", MaxMessageBytes)
	}
	if len(bytes.TrimSpace(line)) == 0 {
		return Message{}, errors.New("stream adapter line must contain one JSON object")
	}
	if bytes.ContainsAny(line, "\r\n") {
		return Message{}, errors.New("stream adapter parser accepts one line without a terminator")
	}
	object, err := decodeObject(line, "stream message")
	if err != nil {
		return Message{}, err
	}
	if err := requireExactKeys(object, "stream message", "kind", "message"); err != nil {
		return Message{}, err
	}
	kind, err := decodeString(object["kind"], "kind")
	if err != nil {
		return Message{}, err
	}
	rawMessage := object["message"]
	switch kind {
	case "request":
		request, err := decodeRequest(rawMessage)
		if err != nil {
			return Message{}, err
		}
		return Message{Kind: kind, Request: &request}, nil
	case "response":
		response, err := decodeResponse(rawMessage)
		if err != nil {
			return Message{}, err
		}
		return Message{Kind: kind, Response: &response}, nil
	default:
		return Message{}, fmt.Errorf("unknown stream message kind %q", kind)
	}
}

func EncodeMessage(message Message) ([]byte, error) {
	var envelope map[string]any
	switch message.Kind {
	case "request":
		if message.Request == nil || message.Response != nil {
			return nil, errors.New("request message must contain exactly one request")
		}
		encoded, err := requestObject(*message.Request)
		if err != nil {
			return nil, err
		}
		envelope = map[string]any{"kind": "request", "message": encoded}
	case "response":
		if message.Response == nil || message.Request != nil {
			return nil, errors.New("response message must contain exactly one response")
		}
		encoded, err := responseObject(*message.Response)
		if err != nil {
			return nil, err
		}
		envelope = map[string]any{"kind": "response", "message": encoded}
	default:
		return nil, fmt.Errorf("unknown stream message kind %q", message.Kind)
	}
	canonical, err := Canonicalize(envelope)
	if err != nil {
		return nil, err
	}
	return json.Marshal(canonical)
}

func decodeRequest(raw json.RawMessage) (Request, error) {
	object, err := decodeObject(raw, "request")
	if err != nil {
		return Request{}, err
	}
	if err := requireExactKeys(object, "request", "protocol", "protocolVersion", "requestId", "machine", "generation", "operation"); err != nil {
		return Request{}, err
	}
	request := Request{}
	if request.Protocol, err = decodeString(object["protocol"], "protocol"); err != nil {
		return Request{}, err
	}
	if request.ProtocolVersion, err = decodeInt(object["protocolVersion"], "protocolVersion"); err != nil {
		return Request{}, err
	}
	if request.RequestID, err = decodeString(object["requestId"], "requestId"); err != nil {
		return Request{}, err
	}
	if request.Machine, err = decodeString(object["machine"], "machine"); err != nil {
		return Request{}, err
	}
	if request.Generation, err = decodeUint64(object["generation"], "generation"); err != nil {
		return Request{}, err
	}
	if request.Operation, err = decodeOperation(object["operation"]); err != nil {
		return Request{}, err
	}
	if err := request.Validate(); err != nil {
		return Request{}, err
	}
	return request, nil
}

func decodeResponse(raw json.RawMessage) (Response, error) {
	object, err := decodeObject(raw, "response")
	if err != nil {
		return Response{}, err
	}
	if err := requireExactKeys(object, "response", "protocol", "protocolVersion", "requestId", "machine", "generation", "operation", "outcome"); err != nil {
		return Response{}, err
	}
	response := Response{}
	if response.Protocol, err = decodeString(object["protocol"], "protocol"); err != nil {
		return Response{}, err
	}
	if response.ProtocolVersion, err = decodeInt(object["protocolVersion"], "protocolVersion"); err != nil {
		return Response{}, err
	}
	if response.RequestID, err = decodeString(object["requestId"], "requestId"); err != nil {
		return Response{}, err
	}
	if response.Machine, err = decodeString(object["machine"], "machine"); err != nil {
		return Response{}, err
	}
	if response.Generation, err = decodeUint64(object["generation"], "generation"); err != nil {
		return Response{}, err
	}
	if response.Operation, err = decodeString(object["operation"], "operation"); err != nil {
		return Response{}, err
	}
	if response.Outcome, err = decodeOutcome(object["outcome"]); err != nil {
		return Response{}, err
	}
	if err := response.Validate(); err != nil {
		return Response{}, err
	}
	return response, nil
}

func decodeOperation(raw json.RawMessage) (Operation, error) {
	object, err := decodeObject(raw, "operation")
	if err != nil {
		return Operation{}, err
	}
	name, err := decodeString(object["name"], "operation.name")
	if err != nil {
		return Operation{}, err
	}
	operation := Operation{Name: name}
	switch name {
	case "hello", "observe", "snapshot", "close":
		if err := requireExactKeys(object, "operation", "name"); err != nil {
			return Operation{}, err
		}
	case "reset":
		if err := requireKeys(object, "operation", []string{"name", "initialState", "logicalTime"}, []string{"seed"}); err != nil {
			return Operation{}, err
		}
		if operation.InitialState, err = decodeCanonical(object["initialState"]); err != nil {
			return Operation{}, fmt.Errorf("initialState: %w", err)
		}
		if operation.LogicalTime, err = decodeCanonical(object["logicalTime"]); err != nil {
			return Operation{}, fmt.Errorf("logicalTime: %w", err)
		}
		if rawSeed, ok := object["seed"]; ok {
			if operation.Seed, err = decodeString(rawSeed, "seed"); err != nil {
				return Operation{}, err
			}
		}
	case "apply":
		if err := requireKeys(object, "operation", []string{"name", "action", "logicalTime"}, []string{"arguments"}); err != nil {
			return Operation{}, err
		}
		if operation.Action, err = decodeString(object["action"], "action"); err != nil {
			return Operation{}, err
		}
		if operation.LogicalTime, err = decodeCanonical(object["logicalTime"]); err != nil {
			return Operation{}, fmt.Errorf("logicalTime: %w", err)
		}
		operation.Arguments = nil
		if rawArguments, ok := object["arguments"]; ok {
			if operation.Arguments, err = decodeCanonical(rawArguments); err != nil {
				return Operation{}, fmt.Errorf("arguments: %w", err)
			}
		}
	case "settle":
		if err := requireExactKeys(object, "operation", "name", "maxSteps"); err != nil {
			return Operation{}, err
		}
		if operation.MaxSteps, err = decodeUint64(object["maxSteps"], "maxSteps"); err != nil {
			return Operation{}, err
		}
	case "restore":
		if err := requireExactKeys(object, "operation", "name", "snapshot", "schemaHash"); err != nil {
			return Operation{}, err
		}
		if operation.Snapshot, err = decodeCanonical(object["snapshot"]); err != nil {
			return Operation{}, fmt.Errorf("snapshot: %w", err)
		}
		if operation.SchemaHash, err = decodeString(object["schemaHash"], "schemaHash"); err != nil {
			return Operation{}, err
		}
	case "fault":
		if err := requireKeys(object, "operation", []string{"name", "fault"}, []string{"arguments"}); err != nil {
			return Operation{}, err
		}
		if operation.Fault, err = decodeString(object["fault"], "fault"); err != nil {
			return Operation{}, err
		}
		if rawArguments, ok := object["arguments"]; ok {
			if operation.Arguments, err = decodeCanonical(rawArguments); err != nil {
				return Operation{}, fmt.Errorf("arguments: %w", err)
			}
		}
	default:
		return Operation{}, fmt.Errorf("unsupported operation %q", name)
	}
	return operation, nil
}

func decodeOutcome(raw json.RawMessage) (Outcome, error) {
	object, err := decodeObject(raw, "outcome")
	if err != nil {
		return Outcome{}, err
	}
	kind, err := decodeString(object["kind"], "outcome.kind")
	if err != nil {
		return Outcome{}, err
	}
	outcome := Outcome{Kind: kind}
	switch kind {
	case "ok":
		if err := requireExactKeys(object, "outcome", "kind", "value"); err != nil {
			return Outcome{}, err
		}
		if outcome.Value, err = decodeCanonical(object["value"]); err != nil {
			return Outcome{}, err
		}
	case "error", "unsupported":
		if err := requireExactKeys(object, "outcome", "kind", "error"); err != nil {
			return Outcome{}, err
		}
		streamError, err := decodeStreamError(object["error"])
		if err != nil {
			return Outcome{}, err
		}
		outcome.Error = &streamError
	default:
		return Outcome{}, fmt.Errorf("unsupported outcome kind %q", kind)
	}
	return outcome, nil
}

func decodeStreamError(raw json.RawMessage) (StreamError, error) {
	object, err := decodeObject(raw, "stream error")
	if err != nil {
		return StreamError{}, err
	}
	if err := requireKeys(object, "stream error", []string{"code", "message", "retryable"}, []string{"data"}); err != nil {
		return StreamError{}, err
	}
	result := StreamError{}
	if result.Code, err = decodeString(object["code"], "error.code"); err != nil {
		return StreamError{}, err
	}
	if result.Message, err = decodeString(object["message"], "error.message"); err != nil {
		return StreamError{}, err
	}
	if result.Retryable, err = decodeBool(object["retryable"], "error.retryable"); err != nil {
		return StreamError{}, err
	}
	if rawData, ok := object["data"]; ok {
		if result.Data, err = decodeCanonical(rawData); err != nil {
			return StreamError{}, err
		}
	}
	if err := result.Validate(); err != nil {
		return StreamError{}, err
	}
	return result, nil
}

func (request Request) Validate() error {
	if err := validateEnvelope(request.Protocol, request.ProtocolVersion, request.RequestID, request.Machine); err != nil {
		return err
	}
	return request.Operation.Validate()
}

func (operation Operation) Validate() error {
	switch operation.Name {
	case "hello", "observe", "snapshot", "close":
		return nil
	case "reset":
		if operation.Seed != "" && strings.TrimSpace(operation.Seed) == "" {
			return errors.New("reset seed must be absent or nonempty")
		}
	case "apply":
		if err := validateLabel("action", operation.Action, 256); err != nil {
			return err
		}
	case "settle":
		if operation.MaxSteps == 0 || operation.MaxSteps > MaxSettleSteps {
			return fmt.Errorf("settle maxSteps must be between 1 and %d", MaxSettleSteps)
		}
	case "restore":
		if err := validateSHA256("restore schemaHash", operation.SchemaHash); err != nil {
			return err
		}
	case "fault":
		if err := validateLabel("fault", operation.Fault, 256); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported operation %q", operation.Name)
	}
	return nil
}

func (response Response) Validate() error {
	if err := validateEnvelope(response.Protocol, response.ProtocolVersion, response.RequestID, response.Machine); err != nil {
		return err
	}
	if !validOperationName(response.Operation) {
		return fmt.Errorf("unsupported response operation %q", response.Operation)
	}
	return response.Outcome.Validate()
}

func (outcome Outcome) Validate() error {
	switch outcome.Kind {
	case "ok":
		if outcome.Error != nil {
			return errors.New("ok outcome cannot contain an error")
		}
		_, err := Canonicalize(outcome.Value)
		return err
	case "error", "unsupported":
		if outcome.Error == nil {
			return fmt.Errorf("%s outcome requires an error", outcome.Kind)
		}
		return outcome.Error.Validate()
	default:
		return fmt.Errorf("unsupported outcome kind %q", outcome.Kind)
	}
}

func (streamError StreamError) Validate() error {
	if err := validateLabel("error code", streamError.Code, 128); err != nil {
		return err
	}
	if err := validateLabel("error message", streamError.Message, 4096); err != nil {
		return err
	}
	if streamError.Data != nil {
		_, err := Canonicalize(streamError.Data)
		return err
	}
	return nil
}

func validateEnvelope(protocol string, version int, requestID, machine string) error {
	if protocol != Protocol {
		return fmt.Errorf("expected protocol %q, got %q", Protocol, protocol)
	}
	if version != ProtocolVersion {
		return fmt.Errorf("expected protocolVersion %d, got %d", ProtocolVersion, version)
	}
	if _, err := ParseRequestID(requestID); err != nil {
		return err
	}
	return validateLabel("machine", machine, 256)
}

func ParseRequestID(value string) (*big.Int, error) {
	if err := ValidateDecimal(value, false); err != nil {
		return nil, fmt.Errorf("requestId: %w", err)
	}
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fmt.Errorf("requestId %q is invalid", value)
	}
	if parsed.Sign() == 0 {
		return nil, errors.New("requestId must be positive")
	}
	if parsed.Cmp(maxRequestID) > 0 {
		return nil, fmt.Errorf("requestId exceeds 2^53-1: %s", value)
	}
	return parsed, nil
}

func validOperationName(value string) bool {
	switch value {
	case "hello", "reset", "apply", "observe", "settle", "snapshot", "restore", "fault", "close":
		return true
	default:
		return false
	}
}

func requestObject(request Request) (map[string]any, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}
	operation := map[string]any{"name": request.Operation.Name}
	switch request.Operation.Name {
	case "reset":
		operation["initialState"] = request.Operation.InitialState
		operation["logicalTime"] = request.Operation.LogicalTime
		if request.Operation.Seed != "" {
			operation["seed"] = request.Operation.Seed
		}
	case "apply":
		operation["action"] = request.Operation.Action
		operation["logicalTime"] = request.Operation.LogicalTime
		if request.Operation.Arguments != nil {
			operation["arguments"] = request.Operation.Arguments
		}
	case "settle":
		operation["maxSteps"] = request.Operation.MaxSteps
	case "restore":
		operation["snapshot"] = request.Operation.Snapshot
		operation["schemaHash"] = request.Operation.SchemaHash
	case "fault":
		operation["fault"] = request.Operation.Fault
		if request.Operation.Arguments != nil {
			operation["arguments"] = request.Operation.Arguments
		}
	}
	return map[string]any{"protocol": request.Protocol, "protocolVersion": request.ProtocolVersion, "requestId": request.RequestID, "machine": request.Machine, "generation": request.Generation, "operation": operation}, nil
}

func responseObject(response Response) (map[string]any, error) {
	if err := response.Validate(); err != nil {
		return nil, err
	}
	outcome := map[string]any{"kind": response.Outcome.Kind}
	if response.Outcome.Kind == "ok" {
		outcome["value"] = response.Outcome.Value
	} else {
		outcome["error"] = response.Outcome.Error
	}
	return map[string]any{"protocol": response.Protocol, "protocolVersion": response.ProtocolVersion, "requestId": response.RequestID, "machine": response.Machine, "generation": response.Generation, "operation": response.Operation, "outcome": outcome}, nil
}

func decodeObject(raw []byte, label string) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var object map[string]json.RawMessage
	if err := dec.Decode(&object); err != nil {
		return nil, fmt.Errorf("decode %s: %w", label, err)
	}
	if object == nil {
		return nil, fmt.Errorf("%s must be an object", label)
	}
	var extra any
	if err := dec.Decode(&extra); err == nil {
		return nil, fmt.Errorf("%s contains trailing JSON", label)
	}
	return object, nil
}

func decodeCanonical(raw json.RawMessage) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return nil, err
	}
	return Canonicalize(value)
}
func decodeString(raw json.RawMessage, label string) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", label)
	}
	return value, nil
}
func decodeBool(raw json.RawMessage, label string) (bool, error) {
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, fmt.Errorf("%s must be boolean", label)
	}
	return value, nil
}
func decodeInt(raw json.RawMessage, label string) (int, error) {
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, fmt.Errorf("%s must be an integer", label)
	}
	return value, nil
}
func decodeUint64(raw json.RawMessage, label string) (uint64, error) {
	var value uint64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, fmt.Errorf("%s must be a nonnegative integer", label)
	}
	return value, nil
}

func requireExactKeys(object map[string]json.RawMessage, label string, keys ...string) error {
	return requireKeys(object, label, keys, nil)
}
func requireKeys(object map[string]json.RawMessage, label string, required, optional []string) error {
	allowed := map[string]bool{}
	for _, key := range required {
		allowed[key] = true
		if _, ok := object[key]; !ok {
			return fmt.Errorf("%s missing field %q", label, key)
		}
	}
	for _, key := range optional {
		allowed[key] = true
	}
	unknown := []string{}
	for key := range object {
		if !allowed[key] {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return fmt.Errorf("%s contains unknown fields: %s", label, strings.Join(unknown, ", "))
	}
	return nil
}
func validateLabel(label, value string, max int) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must be nonempty", label)
	}
	if len(value) > max {
		return fmt.Errorf("%s exceeds %d bytes", label, max)
	}
	return nil
}
func validateSHA256(label, value string) error {
	if len(value) != 71 || !strings.HasPrefix(value, "sha256:") {
		return fmt.Errorf("%s must be sha256:<64 lowercase hex>", label)
	}
	for _, c := range value[7:] {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return fmt.Errorf("%s must be sha256:<64 lowercase hex>", label)
		}
	}
	return nil
}
