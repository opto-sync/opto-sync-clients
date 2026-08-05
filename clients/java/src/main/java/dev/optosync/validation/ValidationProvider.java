package dev.optosync.validation;

import java.util.List;

/** Additional validation-library integration. Providers are veto-only gates. */
public interface ValidationProvider {
    String name();

    List<ValidationIssue> validate(Object decoded);
}
