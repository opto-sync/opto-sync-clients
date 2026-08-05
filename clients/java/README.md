# opto-sync Java envelope validation

The Java validator is dependency-free and accepts either the built-in strict JSON decoder or an application-supplied decoder.

```java
var envelope = EnvelopeValidator.parse(json);
var jackson = ReflectiveJsonDecoders.jackson(objectMapper);
var provider = ValidationAdapters.jakartaBeanValidation(decoded -> {
    // Map to your annotated bean and return violation messages.
    return validator.validate(bean).stream().map(Object::toString).toList();
});
var checked = EnvelopeValidator.parse(json, jackson, List.of(provider));
```

`ReflectiveJsonDecoders` supports Jackson and Gson without forcing either library into downstream dependency graphs. Named callback providers cover Jakarta/Hibernate Validator and NetworkNT/Everit JSON Schema while retaining exact library-version choice in the consuming application.
