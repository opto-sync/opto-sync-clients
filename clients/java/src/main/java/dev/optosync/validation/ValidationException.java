package dev.optosync.validation;

import java.util.List;
import java.util.stream.Collectors;

/** Raised when an envelope or an additional provider rejects decoded input. */
@SuppressWarnings("serial")
public final class ValidationException extends IllegalArgumentException {
    private static final long serialVersionUID = 1L;

    private final List<ValidationIssue> issues;

    public ValidationException(List<ValidationIssue> issues) {
        super("envelope failed validation: " + issues.stream()
                .map(ValidationIssue::toString)
                .collect(Collectors.joining("; ")));
        this.issues = List.copyOf(issues);
    }

    public List<ValidationIssue> issues() {
        return issues;
    }
}
