package fmadapter

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"sort"
	"strings"
)

var (
	minInt64  = new(big.Int).Neg(new(big.Int).Lsh(big.NewInt(1), 63))
	maxUint64 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 64), big.NewInt(1))
)

// CanonicalJSON validates and canonicalizes the formal-adapter JSON subset.
// Floating-point numbers are forbidden. ITF #bigint, #set, and #map values are
// normalized recursively and duplicate canonical set values/map keys fail closed.
func CanonicalJSON(input []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(input))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode canonical JSON: %w", err)
	}
	if dec.More() {
		return nil, errors.New("canonical JSON contains more than one value")
	}
	// A second decode must reach EOF.
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, errors.New("canonical JSON contains trailing value")
		}
		return nil, fmt.Errorf("canonical JSON contains trailing data: %w", err)
	}
	canonical, err := Canonicalize(value)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return nil, fmt.Errorf("encode canonical JSON: %w", err)
	}
	return encoded, nil
}

// Canonicalize returns a deep-copied canonical value suitable for encoding/json.
func Canonicalize(value any) (any, error) {
	switch typed := value.(type) {
	case nil, bool, string:
		return typed, nil
	case json.Number:
		return canonicalNumber(typed)
	case float64, float32:
		return nil, errors.New("canonical adapter JSON forbids floating-point numbers")
	case int:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case int8:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case int16:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case int32:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case int64:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case uint:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case uint8:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case uint16:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case uint32:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case uint64:
		return json.Number(fmt.Sprintf("%d", typed)), nil
	case []any:
		result := make([]any, len(typed))
		for i, item := range typed {
			canonical, err := Canonicalize(item)
			if err != nil {
				return nil, fmt.Errorf("canonicalize array item %d: %w", i, err)
			}
			result[i] = canonical
		}
		return result, nil
	case map[string]any:
		if len(typed) == 1 {
			if raw, ok := typed["#bigint"]; ok {
				return canonicalBigInt(raw)
			}
			if raw, ok := typed["#set"]; ok {
				return canonicalSet(raw)
			}
			if raw, ok := typed["#map"]; ok {
				return canonicalMap(raw)
			}
		}
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			canonical, err := Canonicalize(item)
			if err != nil {
				return nil, fmt.Errorf("canonicalize object field %q: %w", key, err)
			}
			result[key] = canonical
		}
		return result, nil
	default:
		// Normalize structs and typed slices/maps through encoding/json while
		// retaining integer precision with UseNumber.
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil, fmt.Errorf("marshal canonical value: %w", err)
		}
		dec := json.NewDecoder(bytes.NewReader(encoded))
		dec.UseNumber()
		var normalized any
		if err := dec.Decode(&normalized); err != nil {
			return nil, fmt.Errorf("decode normalized canonical value: %w", err)
		}
		return Canonicalize(normalized)
	}
}

func canonicalNumber(number json.Number) (any, error) {
	text := number.String()
	if strings.ContainsAny(text, ".eE") {
		return nil, errors.New("canonical adapter JSON forbids floating-point numbers")
	}
	integer, ok := new(big.Int).SetString(text, 10)
	if !ok {
		return nil, fmt.Errorf("invalid JSON integer %q", text)
	}
	if integer.Sign() < 0 && integer.Cmp(minInt64) < 0 {
		return nil, fmt.Errorf("ordinary JSON integer %q is below i64; encode it as #bigint", text)
	}
	if integer.Sign() >= 0 && integer.Cmp(maxUint64) > 0 {
		return nil, fmt.Errorf("ordinary JSON integer %q exceeds u64; encode it as #bigint", text)
	}
	if integer.Sign() == 0 {
		text = "0"
	} else {
		text = integer.String()
	}
	return json.Number(text), nil
}

func canonicalBigInt(raw any) (any, error) {
	text, ok := raw.(string)
	if !ok {
		return nil, errors.New("ITF #bigint must contain a string")
	}
	if err := ValidateDecimal(text, true); err != nil {
		return nil, fmt.Errorf("ITF #bigint: %w", err)
	}
	return map[string]any{"#bigint": text}, nil
}

func canonicalSet(raw any) (any, error) {
	values, ok := raw.([]any)
	if !ok {
		return nil, errors.New("ITF #set must contain an array")
	}
	type entry struct {
		key   string
		value any
	}
	entries := make([]entry, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for i, value := range values {
		canonical, err := Canonicalize(value)
		if err != nil {
			return nil, fmt.Errorf("canonicalize ITF #set item %d: %w", i, err)
		}
		encoded, err := json.Marshal(canonical)
		if err != nil {
			return nil, fmt.Errorf("encode ITF #set item %d: %w", i, err)
		}
		key := string(encoded)
		if _, duplicate := seen[key]; duplicate {
			return nil, errors.New("ITF #set contains duplicate canonical values")
		}
		seen[key] = struct{}{}
		entries = append(entries, entry{key: key, value: canonical})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].key < entries[j].key })
	sorted := make([]any, len(entries))
	for i, item := range entries {
		sorted[i] = item.value
	}
	return map[string]any{"#set": sorted}, nil
}

func canonicalMap(raw any) (any, error) {
	values, ok := raw.([]any)
	if !ok {
		return nil, errors.New("ITF #map must contain an array")
	}
	type entry struct {
		keyEncoded string
		key        any
		value      any
	}
	entries := make([]entry, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for i, rawEntry := range values {
		pair, ok := rawEntry.([]any)
		if !ok || len(pair) != 2 {
			return nil, fmt.Errorf("ITF #map entry %d must be a two-element [key, value] array", i)
		}
		key, err := Canonicalize(pair[0])
		if err != nil {
			return nil, fmt.Errorf("canonicalize ITF #map key %d: %w", i, err)
		}
		value, err := Canonicalize(pair[1])
		if err != nil {
			return nil, fmt.Errorf("canonicalize ITF #map value %d: %w", i, err)
		}
		encodedKey, err := json.Marshal(key)
		if err != nil {
			return nil, fmt.Errorf("encode ITF #map key %d: %w", i, err)
		}
		encoded := string(encodedKey)
		if _, duplicate := seen[encoded]; duplicate {
			return nil, errors.New("ITF #map contains duplicate canonical keys")
		}
		seen[encoded] = struct{}{}
		entries = append(entries, entry{keyEncoded: encoded, key: key, value: value})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].keyEncoded < entries[j].keyEncoded })
	sorted := make([]any, len(entries))
	for i, item := range entries {
		sorted[i] = []any{item.key, item.value}
	}
	return map[string]any{"#map": sorted}, nil
}

// ValidateDecimal validates canonical decimal strings. Negative values are
// accepted only when allowNegative is true. Plus signs, leading zeroes and
// negative zero are rejected.
func ValidateDecimal(value string, allowNegative bool) error {
	if value == "" {
		return errors.New("decimal string is empty")
	}
	if value[0] == '+' {
		return errors.New("plus sign is forbidden")
	}
	negative := value[0] == '-'
	digits := value
	if negative {
		if !allowNegative {
			return errors.New("negative value is forbidden")
		}
		digits = value[1:]
		if digits == "" {
			return errors.New("minus sign must be followed by digits")
		}
	}
	for _, char := range digits {
		if char < '0' || char > '9' {
			return errors.New("decimal contains non-digit characters")
		}
	}
	if len(digits) > 1 && digits[0] == '0' {
		return errors.New("leading zeroes are forbidden")
	}
	if negative && digits == "0" {
		return errors.New("negative zero is forbidden")
	}
	return nil
}
