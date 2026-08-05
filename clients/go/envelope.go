// Package validation implements the shared opto-sync ingest-envelope contract.
package validation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const MaxSafeTimestampInteger uint64 = 9_007_199_254_740_991

var (
	identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)
	digitPattern      = regexp.MustCompile(`^[0-9]{1,20}$`)
	decimalPattern    = regexp.MustCompile(`^(?:0|[1-9][0-9]*)$`)
	nativeHLCPattern  = regexp.MustCompile(`^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$`)
	iso8601Pattern    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`)
	maxSafeInteger    = new(big.Int).SetUint64(MaxSafeTimestampInteger)
)

type Operation string

const (
	OperationUpsert Operation = "upsert"
	OperationDelete Operation = "delete"
)

type Record struct {
	Table        string
	RecordID     string
	Operation    Operation
	BaseRevision *string
	Payload      map[string]any
}

type Envelope struct {
	Source  *string
	Records []Record
}

type Issue struct {
	Path     string
	Message  string
	Provider string
}

func (i Issue) String() string {
	path := i.Path
	if path == "" {
		path = "<root>"
	}
	if i.Provider != "" {
		return fmt.Sprintf("provider[%s] %s: %s", i.Provider, path, i.Message)
	}
	return fmt.Sprintf("%s: %s", path, i.Message)
}

type ValidationError struct {
	Issues []Issue
}

func (e *ValidationError) Error() string {
	parts := make([]string, len(e.Issues))
	for index, issue := range e.Issues {
		parts[index] = issue.String()
	}
	return "envelope failed validation: " + strings.Join(parts, "; ")
}

type Provider interface {
	Name() string
	Validate(value any) []Issue
}

type ProviderFunc struct {
	ProviderName string
	ValidateFunc func(any) []Issue
}

func (p ProviderFunc) Name() string { return p.ProviderName }

func (p ProviderFunc) Validate(value any) []Issue {
	if p.ValidateFunc == nil {
		return []Issue{{Provider: p.ProviderName, Message: "provider has no validation function"}}
	}
	issues := p.ValidateFunc(value)
	out := make([]Issue, len(issues))
	for index, issue := range issues {
		issue.Provider = p.ProviderName
		out[index] = issue
	}
	return out
}

// GoPlaygroundProvider adapts go-playground/validator or a compatible callback.
func GoPlaygroundProvider(validate func(any) error) Provider {
	return errorProvider("go-playground/validator", validate)
}

// JSONSchemaProvider adapts santhosh-tekuri/jsonschema or another JSON Schema engine.
func JSONSchemaProvider(validate func(any) error) Provider {
	return errorProvider("jsonschema", validate)
}

func errorProvider(name string, validate func(any) error) Provider {
	return ProviderFunc{
		ProviderName: name,
		ValidateFunc: func(value any) []Issue {
			if validate == nil {
				return []Issue{{Message: "provider has no validation function"}}
			}
			if err := validate(value); err != nil {
				return []Issue{{Message: err.Error()}}
			}
			return nil
		},
	}
}

func safeProviderName(provider Provider) (name string) {
	if provider == nil {
		return "<nil>"
	}
	name = "<unnamed-provider>"
	defer func() {
		if recover() != nil {
			name = "<panicked-provider-name>"
		}
	}()
	if found := provider.Name(); found != "" {
		name = found
	}
	return name
}

func runProvider(provider Provider, value any) (name string, issues []Issue) {
	name = safeProviderName(provider)
	if provider == nil {
		return name, []Issue{{Provider: name, Message: "nil provider"}}
	}
	defer func() {
		if recover() != nil {
			issues = []Issue{{Provider: name, Message: "provider panicked"}}
		}
	}()
	raw := provider.Validate(value)
	issues = make([]Issue, len(raw))
	for index, issue := range raw {
		if issue.Provider == "" {
			issue.Provider = name
		}
		if issue.Message == "" {
			issue.Message = "validation failed"
		}
		issues[index] = issue
	}
	return name, issues
}

func decodeJSON(text []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(text))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("invalid JSON: multiple top-level values")
		}
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return value, nil
}

func ParseJSON(text []byte, providers ...Provider) (*Envelope, error) {
	value, err := decodeJSON(text)
	if err != nil {
		return nil, &ValidationError{Issues: []Issue{{Message: err.Error()}}}
	}
	return Validate(value, providers...)
}

func Validate(value any, providers ...Provider) (*Envelope, error) {
	envelope, canonicalIssues := validateCanonical(value)
	issues := append([]Issue(nil), canonicalIssues...)
	for _, provider := range providers {
		_, providerIssues := runProvider(provider, value)
		issues = append(issues, providerIssues...)
	}
	if len(issues) != 0 {
		return nil, &ValidationError{Issues: issues}
	}
	return envelope, nil
}

type ProviderAudit struct {
	Provider          string
	CanonicalAccepted bool
	ProviderAccepted  bool
	Drift             bool
	ProviderIssues    []Issue
}

func AuditProvider(value any, provider Provider) ProviderAudit {
	_, canonicalIssues := validateCanonical(value)
	name, providerIssues := runProvider(provider, value)
	canonicalAccepted := len(canonicalIssues) == 0
	providerAccepted := len(providerIssues) == 0
	return ProviderAudit{
		Provider:          name,
		CanonicalAccepted: canonicalAccepted,
		ProviderAccepted:  providerAccepted,
		Drift:             canonicalAccepted != providerAccepted,
		ProviderIssues:    providerIssues,
	}
}

func validateCanonical(value any) (*Envelope, []Issue) {
	root, ok := value.(map[string]any)
	if !ok {
		return nil, []Issue{{Message: "expected an object"}}
	}

	issues := make([]Issue, 0)
	appendUnknownKeys(&issues, root, map[string]struct{}{
		"formatVersion": {},
		"source":        {},
		"records":       {},
	}, "")

	version, exists := root["formatVersion"]
	if !exists {
		issues = append(issues, Issue{Path: "formatVersion", Message: "required"})
	} else if !isExactOne(version) {
		issues = append(issues, Issue{Path: "formatVersion", Message: "must be 1"})
	}

	var source *string
	if rawSource, exists := root["source"]; exists {
		text, ok := rawSource.(string)
		if !ok || utf8.RuneCountInString(text) > 200 {
			issues = append(issues, Issue{Path: "source", Message: "must be a string of at most 200 Unicode code points"})
		} else {
			source = &text
		}
	}

	records := make([]Record, 0)
	rawRecords, exists := root["records"]
	if !exists {
		issues = append(issues, Issue{Path: "records", Message: "required"})
	} else if items, ok := rawRecords.([]any); !ok {
		issues = append(issues, Issue{Path: "records", Message: "must be an array"})
	} else if len(items) == 0 {
		issues = append(issues, Issue{Path: "records", Message: "must contain at least one record"})
	} else {
		for index, item := range items {
			record, recordIssues := validateRecord(item, index)
			issues = append(issues, recordIssues...)
			if len(recordIssues) == 0 {
				records = append(records, record)
			}
		}
	}

	if len(issues) != 0 {
		return nil, issues
	}
	return &Envelope{Source: source, Records: records}, nil
}

func validateRecord(value any, index int) (Record, []Issue) {
	path := "records." + strconv.Itoa(index)
	object, ok := value.(map[string]any)
	if !ok {
		return Record{}, []Issue{{Path: path, Message: "expected an object"}}
	}

	issues := make([]Issue, 0)
	appendUnknownKeys(&issues, object, map[string]struct{}{
		"table":        {},
		"recordId":     {},
		"operation":    {},
		"baseRevision": {},
		"payload":      {},
	}, path)

	table, tableOK := object["table"].(string)
	if !tableOK || !identifierPattern.MatchString(table) {
		issues = append(issues, Issue{Path: path + ".table", Message: "must be a SQL-safe identifier"})
	}

	recordID, recordIDOK := object["recordId"].(string)
	if !recordIDOK {
		issues = append(issues, Issue{Path: path + ".recordId", Message: "must be a string of 1..512 Unicode code points"})
	} else if length := utf8.RuneCountInString(recordID); length < 1 || length > 512 {
		issues = append(issues, Issue{Path: path + ".recordId", Message: "must be a string of 1..512 Unicode code points"})
	}

	operation := OperationUpsert
	if rawOperation, exists := object["operation"]; exists {
		operationText, ok := rawOperation.(string)
		if !ok || (operationText != string(OperationUpsert) && operationText != string(OperationDelete)) {
			issues = append(issues, Issue{Path: path + ".operation", Message: "must be upsert or delete"})
		} else {
			operation = Operation(operationText)
		}
	}

	var baseRevision *string
	if rawRevision, exists := object["baseRevision"]; exists {
		revision, ok := rawRevision.(string)
		if !ok || !decimalPattern.MatchString(revision) {
			issues = append(issues, Issue{Path: path + ".baseRevision", Message: "must be a canonical decimal string"})
		} else {
			baseRevision = &revision
		}
	}

	payload, payloadOK := object["payload"].(map[string]any)
	if !payloadOK {
		issues = append(issues, Issue{Path: path + ".payload", Message: "must be an object"})
		payload = map[string]any{}
	} else if operation == OperationDelete {
		if len(payload) != 0 {
			issues = append(issues, Issue{Path: path + ".payload", Message: "a delete record must carry an empty payload"})
		}
	} else {
		updatedAt, exists := payload["updatedAt"]
		if !exists || !isTimestamp(updatedAt) {
			issues = append(issues, Issue{Path: path + ".payload.updatedAt", Message: "invalid or missing timestamp"})
		}
		for _, key := range []string{"createdAt", "syncedAt"} {
			if timestamp, exists := payload[key]; exists && !isTimestamp(timestamp) {
				issues = append(issues, Issue{Path: path + ".payload." + key, Message: "invalid timestamp"})
			}
		}
	}

	return Record{
		Table:        table,
		RecordID:     recordID,
		Operation:    operation,
		BaseRevision: baseRevision,
		Payload:      payload,
	}, issues
}

func appendUnknownKeys(issues *[]Issue, object map[string]any, allowed map[string]struct{}, path string) {
	keys := make([]string, 0)
	for key := range object {
		if _, ok := allowed[key]; !ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		fullPath := key
		if path != "" {
			fullPath = path + "." + key
		}
		*issues = append(*issues, Issue{Path: fullPath, Message: "unrecognized key"})
	}
}

func isExactOne(value any) bool {
	switch number := value.(type) {
	case json.Number:
		rational, ok := new(big.Rat).SetString(number.String())
		return ok && rational.Cmp(big.NewRat(1, 1)) == 0
	case float64:
		return number == 1
	case int:
		return number == 1
	case int64:
		return number == 1
	default:
		return false
	}
}

func isTimestamp(value any) bool {
	switch typed := value.(type) {
	case json.Number:
		return isSafeJSONInteger(typed.String())
	case float64:
		return !math.IsNaN(typed) && !math.IsInf(typed, 0) && typed >= 0 && typed <= float64(MaxSafeTimestampInteger) && math.Trunc(typed) == typed
	case int:
		return typed >= 0 && uint64(typed) <= MaxSafeTimestampInteger
	case int64:
		return typed >= 0 && uint64(typed) <= MaxSafeTimestampInteger
	case uint64:
		return typed <= MaxSafeTimestampInteger
	case string:
		return digitPattern.MatchString(typed) || nativeHLCPattern.MatchString(typed) || iso8601Pattern.MatchString(typed)
	default:
		return false
	}
}

func isSafeJSONInteger(text string) bool {
	if len(text) > 256 {
		return false
	}
	rational, ok := new(big.Rat).SetString(text)
	if !ok || !rational.IsInt() || rational.Sign() < 0 {
		return false
	}
	return rational.Num().Cmp(maxSafeInteger) <= 0
}
