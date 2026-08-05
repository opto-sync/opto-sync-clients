package dev.optosync.validation;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Canonical Java implementation of the opto-sync ingest-envelope contract. */
public final class EnvelopeValidator {
    public static final long MAX_SAFE_TIMESTAMP_INTEGER = 9_007_199_254_740_991L;

    private static final BigDecimal MAX_SAFE_DECIMAL = BigDecimal.valueOf(MAX_SAFE_TIMESTAMP_INTEGER);
    private static final Pattern IDENTIFIER = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]{0,62}$");
    private static final Pattern DIGITS = Pattern.compile("^[0-9]{1,20}$");
    private static final Pattern DECIMAL = Pattern.compile("^(?:0|[1-9][0-9]*)$");
    private static final Pattern NATIVE_HLC = Pattern.compile("^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$");
    private static final Pattern ISO_8601 = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$");
    private static final Set<String> ENVELOPE_KEYS = Set.of("formatVersion", "source", "records");
    private static final Set<String> RECORD_KEYS = Set.of(
            "table", "recordId", "operation", "baseRevision", "payload");

    private EnvelopeValidator() {}

    public enum Operation {
        UPSERT,
        DELETE
    }

    public record IngestRecord(
            String table,
            String recordId,
            Operation operation,
            String baseRevision,
            Map<String, Object> payload) {
        public IngestRecord {
            payload = Collections.unmodifiableMap(new LinkedHashMap<>(payload));
        }
    }

    public record Envelope(String source, List<IngestRecord> records) {
        public Envelope {
            records = List.copyOf(records);
        }
    }

    public record ProviderAuditResult(
            String provider,
            boolean canonicalAccepted,
            boolean providerAccepted,
            boolean drift,
            List<ValidationIssue> providerIssues) {
        public ProviderAuditResult {
            providerIssues = List.copyOf(providerIssues);
        }
    }

    public static Envelope parse(String text) {
        return parse(text, new StrictJsonDecoder(), List.of());
    }

    public static Envelope parse(
            String text,
            JsonDecoder decoder,
            List<? extends ValidationProvider> providers) {
        final Object decoded;
        try {
            decoded = decoder.decode(text);
        } catch (Exception error) {
            throw new ValidationException(List.of(new ValidationIssue(
                    "", "invalid JSON: " + error.getMessage())));
        }
        return validate(decoded, providers);
    }

    public static Envelope validate(Object decoded) {
        return validate(decoded, List.of());
    }

    public static Envelope validate(
            Object decoded,
            List<? extends ValidationProvider> providers) {
        CanonicalResult canonical = validateCanonical(decoded);
        List<ValidationIssue> issues = new ArrayList<>(canonical.issues());
        if (providers == null) {
            issues.add(new ValidationIssue("", "provider list must not be null", "<null>"));
        } else {
            for (ValidationProvider provider : providers) {
                issues.addAll(runProvider(provider, decoded).issues());
            }
        }
        if (!issues.isEmpty()) {
            throw new ValidationException(issues);
        }
        return canonical.envelope();
    }

    public static ProviderAuditResult auditProvider(Object decoded, ValidationProvider provider) {
        CanonicalResult canonical = validateCanonical(decoded);
        ProviderRun providerRun = runProvider(provider, decoded);
        boolean canonicalAccepted = canonical.issues().isEmpty();
        boolean providerAccepted = providerRun.issues().isEmpty();
        return new ProviderAuditResult(
                providerRun.name(),
                canonicalAccepted,
                providerAccepted,
                canonicalAccepted != providerAccepted,
                providerRun.issues());
    }

    private record ProviderRun(String name, List<ValidationIssue> issues) {
        private ProviderRun {
            issues = List.copyOf(issues);
        }
    }

    private static ProviderRun runProvider(ValidationProvider provider, Object decoded) {
        if (provider == null) {
            return new ProviderRun(
                    "<null>",
                    List.of(new ValidationIssue("", "nil provider", "<null>")));
        }
        String name = providerName(provider);
        try {
            List<ValidationIssue> rawIssues = provider.validate(decoded);
            if (rawIssues == null) {
                return new ProviderRun(
                        name,
                        List.of(new ValidationIssue(
                                "", "provider returned a null issue list", name)));
            }
            List<ValidationIssue> normalized = new ArrayList<>(rawIssues.size());
            for (ValidationIssue issue : rawIssues) {
                if (issue == null) {
                    normalized.add(new ValidationIssue("", "validation failed", name));
                } else {
                    normalized.add(new ValidationIssue(
                            issue.path(),
                            issue.message(),
                            issue.provider().isEmpty() ? name : issue.provider()));
                }
            }
            return new ProviderRun(name, normalized);
        } catch (RuntimeException error) {
            return new ProviderRun(
                    name,
                    List.of(new ValidationIssue(
                            "",
                            "provider threw: " + error.getClass().getSimpleName(),
                            name)));
        }
    }

    private static String providerName(ValidationProvider provider) {
        try {
            String name = provider.name();
            return name == null || name.isBlank() ? "<unnamed-provider>" : name;
        } catch (RuntimeException error) {
            return "<unreadable-provider>";
        }
    }

    private record CanonicalResult(Envelope envelope, List<ValidationIssue> issues) {}

    private static CanonicalResult validateCanonical(Object decoded) {
        Map<String, Object> root = stringMap(decoded);
        if (root == null) {
            return new CanonicalResult(null, List.of(new ValidationIssue("", "expected an object")));
        }

        List<ValidationIssue> issues = new ArrayList<>();
        appendUnknownKeys(issues, root, ENVELOPE_KEYS, "");

        if (!root.containsKey("formatVersion")) {
            issues.add(new ValidationIssue("formatVersion", "required"));
        } else if (!isExactOne(root.get("formatVersion"))) {
            issues.add(new ValidationIssue("formatVersion", "must be 1"));
        }

        String source = null;
        if (root.containsKey("source")) {
            Object rawSource = root.get("source");
            if (rawSource instanceof String text && codePointLength(text) <= 200) {
                source = text;
            } else {
                issues.add(new ValidationIssue(
                        "source", "must be a string of at most 200 Unicode code points"));
            }
        }

        List<IngestRecord> records = new ArrayList<>();
        if (!root.containsKey("records")) {
            issues.add(new ValidationIssue("records", "required"));
        } else if (!(root.get("records") instanceof List<?> rawRecords)) {
            issues.add(new ValidationIssue("records", "must be an array"));
        } else if (rawRecords.isEmpty()) {
            issues.add(new ValidationIssue("records", "must contain at least one record"));
        } else {
            for (int index = 0; index < rawRecords.size(); index++) {
                RecordResult record = validateRecord(rawRecords.get(index), index);
                issues.addAll(record.issues());
                if (record.issues().isEmpty()) {
                    records.add(record.record());
                }
            }
        }

        Envelope envelope = issues.isEmpty() ? new Envelope(source, records) : null;
        return new CanonicalResult(envelope, List.copyOf(issues));
    }

    private record RecordResult(IngestRecord record, List<ValidationIssue> issues) {}

    private static RecordResult validateRecord(Object decoded, int index) {
        String path = "records." + index;
        Map<String, Object> object = stringMap(decoded);
        if (object == null) {
            return new RecordResult(null, List.of(new ValidationIssue(path, "expected an object")));
        }

        List<ValidationIssue> issues = new ArrayList<>();
        appendUnknownKeys(issues, object, RECORD_KEYS, path);

        String table = null;
        Object rawTable = object.get("table");
        if (rawTable instanceof String text && IDENTIFIER.matcher(text).matches()) {
            table = text;
        } else {
            issues.add(new ValidationIssue(path + ".table", "must be a SQL-safe identifier"));
        }

        String recordId = null;
        Object rawRecordId = object.get("recordId");
        if (rawRecordId instanceof String text
                && codePointLength(text) >= 1
                && codePointLength(text) <= 512) {
            recordId = text;
        } else {
            issues.add(new ValidationIssue(
                    path + ".recordId", "must be a string of 1..512 Unicode code points"));
        }

        Operation operation = Operation.UPSERT;
        if (object.containsKey("operation")) {
            Object rawOperation = object.get("operation");
            if ("upsert".equals(rawOperation)) {
                operation = Operation.UPSERT;
            } else if ("delete".equals(rawOperation)) {
                operation = Operation.DELETE;
            } else {
                issues.add(new ValidationIssue(path + ".operation", "must be upsert or delete"));
            }
        }

        String baseRevision = null;
        if (object.containsKey("baseRevision")) {
            Object rawRevision = object.get("baseRevision");
            if (rawRevision instanceof String text && DECIMAL.matcher(text).matches()) {
                baseRevision = text;
            } else {
                issues.add(new ValidationIssue(
                        path + ".baseRevision", "must be a canonical decimal string"));
            }
        }

        Map<String, Object> payload = stringMap(object.get("payload"));
        if (payload == null) {
            issues.add(new ValidationIssue(path + ".payload", "must be an object"));
            payload = Map.of();
        } else if (operation == Operation.DELETE) {
            if (!payload.isEmpty()) {
                issues.add(new ValidationIssue(
                        path + ".payload", "a delete record must carry an empty payload"));
            }
        } else {
            if (!payload.containsKey("updatedAt") || !isTimestamp(payload.get("updatedAt"))) {
                issues.add(new ValidationIssue(
                        path + ".payload.updatedAt", "invalid or missing timestamp"));
            }
            for (String key : List.of("createdAt", "syncedAt")) {
                if (payload.containsKey(key) && !isTimestamp(payload.get(key))) {
                    issues.add(new ValidationIssue(
                            path + ".payload." + key, "invalid timestamp"));
                }
            }
        }

        IngestRecord record = issues.isEmpty()
                ? new IngestRecord(table, recordId, operation, baseRevision, payload)
                : null;
        return new RecordResult(record, List.copyOf(issues));
    }

    private static void appendUnknownKeys(
            List<ValidationIssue> issues,
            Map<String, Object> object,
            Set<String> allowed,
            String path) {
        object.keySet().stream()
                .filter(key -> !allowed.contains(key))
                .sorted(Comparator.naturalOrder())
                .forEach(key -> issues.add(new ValidationIssue(
                        path.isEmpty() ? key : path + "." + key,
                        "unrecognized key")));
    }

    private static Map<String, Object> stringMap(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return null;
        }
        Map<String, Object> converted = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                return null;
            }
            converted.put(key, entry.getValue());
        }
        return converted;
    }

    private static int codePointLength(String value) {
        return value.codePointCount(0, value.length());
    }

    private static boolean isExactOne(Object value) {
        BigDecimal decimal = decimalValue(value);
        return decimal != null && decimal.compareTo(BigDecimal.ONE) == 0;
    }

    private static boolean isTimestamp(Object value) {
        if (value instanceof String text) {
            return DIGITS.matcher(text).matches()
                    || NATIVE_HLC.matcher(text).matches()
                    || ISO_8601.matcher(text).matches();
        }
        BigDecimal decimal = decimalValue(value);
        if (decimal == null || decimal.signum() < 0 || decimal.compareTo(MAX_SAFE_DECIMAL) > 0) {
            return false;
        }
        return decimal.stripTrailingZeros().scale() <= 0;
    }

    private static BigDecimal decimalValue(Object value) {
        if (value instanceof BigDecimal decimal) {
            return decimal;
        }
        if (value instanceof BigInteger integer) {
            return new BigDecimal(integer);
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            return BigDecimal.valueOf(((Number) value).longValue());
        }
        if (value instanceof Float || value instanceof Double) {
            double number = ((Number) value).doubleValue();
            if (!Double.isFinite(number)) {
                return null;
            }
            return BigDecimal.valueOf(number);
        }
        return null;
    }
}
