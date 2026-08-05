# opto-sync Go envelope validation

This module validates the shared ingest envelope using only the Go standard library. `encoding/json.Decoder.UseNumber` preserves the lexical number until the validator can enforce the cross-runtime safe-integer bound.

Additional providers are veto-only gates:

```go
playground := validation.GoPlaygroundProvider(func(value any) error {
    return validatorInstance.Struct(value)
})
jsonSchema := validation.JSONSchemaProvider(func(value any) error {
    return compiledSchema.Validate(value)
})
envelope, err := validation.ParseJSON(body, playground, jsonSchema)
```

The callbacks deliberately avoid hard dependencies on a particular version of `go-playground/validator` or a JSON Schema implementation.
