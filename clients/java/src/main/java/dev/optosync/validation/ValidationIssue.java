package dev.optosync.validation;

/** A normalized validation issue shared by the canonical validator and providers. */
public record ValidationIssue(String path, String message, String provider) {
    public ValidationIssue {
        path = path == null ? "" : path;
        message = message == null ? "validation failed" : message;
        provider = provider == null ? "" : provider;
    }

    public ValidationIssue(String path, String message) {
        this(path, message, "");
    }

    @Override
    public String toString() {
        String location = path.isEmpty() ? "<root>" : path;
        if (provider.isEmpty()) {
            return location + ": " + message;
        }
        return "provider[" + provider + "] " + location + ": " + message;
    }
}
