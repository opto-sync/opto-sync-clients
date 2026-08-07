package dev.optosync.validation;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Objects;

/** Named callback adapters for common Java validation ecosystems. */
public final class ValidationAdapters {
    private ValidationAdapters() {}

    @FunctionalInterface
    public interface LibraryValidator {
        Collection<String> validate(Object decoded) throws Exception;
    }

    public static ValidationProvider jakartaBeanValidation(LibraryValidator validator) {
        return callback("jakarta-validation", validator);
    }

    public static ValidationProvider hibernateValidator(LibraryValidator validator) {
        return callback("hibernate-validator", validator);
    }

    public static ValidationProvider networkntJsonSchema(LibraryValidator validator) {
        return callback("networknt-json-schema", validator);
    }

    public static ValidationProvider everitJsonSchema(LibraryValidator validator) {
        return callback("everit-json-schema", validator);
    }

    public static ValidationProvider callback(String name, LibraryValidator validator) {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(validator, "validator");
        return new ValidationProvider() {
            @Override
            public String name() {
                return name;
            }

            @Override
            public List<ValidationIssue> validate(Object decoded) {
                try {
                    Collection<String> messages = validator.validate(decoded);
                    if (messages == null || messages.isEmpty()) {
                        return List.of();
                    }
                    List<ValidationIssue> issues = new ArrayList<>(messages.size());
                    for (String message : messages) {
                        issues.add(new ValidationIssue("", message, name));
                    }
                    return List.copyOf(issues);
                } catch (Exception error) {
                    return List.of(new ValidationIssue(
                            "",
                            "provider threw: " + error.getMessage(),
                            name));
                }
            }
        };
    }
}
