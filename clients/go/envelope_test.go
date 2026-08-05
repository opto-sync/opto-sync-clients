package validation

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type panicProvider struct{}

func (panicProvider) Name() string { return "panic-provider" }
func (panicProvider) Validate(any) []Issue {
	panic("boom")
}

func fixtureRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Clean(filepath.Join("..", "..", "schema", "fixtures"))
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("cannot locate fixtures: %v", err)
	}
	return root
}

func fixtureFiles(t *testing.T, kind string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(fixtureRoot(t), kind, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		t.Fatalf("no %s fixtures", kind)
	}
	return matches
}

func TestSharedCorpus(t *testing.T) {
	for _, path := range fixtureFiles(t, "valid") {
		text, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ParseJSON(text); err != nil {
			t.Errorf("%s should be accepted: %v", filepath.Base(path), err)
		}
	}
	for _, path := range fixtureFiles(t, "invalid") {
		text, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ParseJSON(text); err == nil {
			t.Errorf("%s should be rejected", filepath.Base(path))
		}
	}
}

func TestMalformedJSONIsNormalized(t *testing.T) {
	_, err := ParseJSON([]byte("{ not json"))
	var validationError *ValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
}

func TestProviderAdaptersAreVetoOnly(t *testing.T) {
	provider := GoPlaygroundProvider(func(any) error { return errors.New("blocked") })
	text := []byte(`{"formatVersion":1,"records":[{"table":"notes","recordId":"n1","payload":{"updatedAt":"1"}}]}`)
	_, err := ParseJSON(text, provider)
	if err == nil || !strings.Contains(err.Error(), "provider[go-playground/validator]") {
		t.Fatalf("expected provider issue, got %v", err)
	}
}

func TestAuditDetectsDrift(t *testing.T) {
	value, err := decodeJSON([]byte(`{"formatVersion":1,"records":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	provider := JSONSchemaProvider(func(any) error { return nil })
	audit := AuditProvider(value, provider)
	if !audit.Drift || audit.CanonicalAccepted || !audit.ProviderAccepted {
		t.Fatalf("unexpected audit result: %+v", audit)
	}
}

func TestProviderPanicsAndNilProvidersAreContained(t *testing.T) {
	text := []byte(`{"formatVersion":1,"records":[{"table":"notes","recordId":"n1","payload":{"updatedAt":"1"}}]}`)
	_, err := ParseJSON(text, panicProvider{})
	if err == nil || !strings.Contains(err.Error(), "provider[panic-provider]") || !strings.Contains(err.Error(), "provider panicked") {
		t.Fatalf("expected normalized provider panic, got %v", err)
	}

	value, decodeErr := decodeJSON(text)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	panicAudit := AuditProvider(value, panicProvider{})
	if panicAudit.ProviderAccepted || !panicAudit.Drift || len(panicAudit.ProviderIssues) != 1 {
		t.Fatalf("unexpected panic audit: %+v", panicAudit)
	}
	nilAudit := AuditProvider(value, nil)
	if nilAudit.ProviderAccepted || !nilAudit.Drift || nilAudit.Provider != "<nil>" {
		t.Fatalf("unexpected nil audit: %+v", nilAudit)
	}
}
