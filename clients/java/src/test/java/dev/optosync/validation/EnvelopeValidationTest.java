package dev.optosync.validation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

public final class EnvelopeValidationTest {
    private EnvelopeValidationTest() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("expected fixture root argument");
        }
        Path fixtures = Path.of(args[0]);
        testCorpus(fixtures);
        testMalformedJson();
        testProviderGate();
        testProviderAudit();
        testReflectiveDecoders();
        System.out.println("Java envelope validation tests passed");
    }

    private static void testCorpus(Path fixtures) throws IOException {
        for (Path path : jsonFiles(fixtures.resolve("valid"))) {
            try {
                EnvelopeValidator.parse(Files.readString(path));
            } catch (ValidationException error) {
                throw new AssertionError(path.getFileName() + " should be accepted", error);
            }
        }
        for (Path path : jsonFiles(fixtures.resolve("invalid"))) {
            boolean rejected = false;
            try {
                EnvelopeValidator.parse(Files.readString(path));
            } catch (ValidationException expected) {
                rejected = true;
            }
            if (!rejected) {
                throw new AssertionError(path.getFileName() + " should be rejected");
            }
        }
    }

    private static List<Path> jsonFiles(Path directory) throws IOException {
        try (Stream<Path> files = Files.list(directory)) {
            List<Path> found = files
                    .filter(path -> path.getFileName().toString().endsWith(".json"))
                    .sorted()
                    .toList();
            if (found.isEmpty()) {
                throw new AssertionError("no fixtures in " + directory);
            }
            return found;
        }
    }

    private static void testMalformedJson() {
        expectValidationFailure(() -> EnvelopeValidator.parse("{ not json"));
    }

    private static void testProviderGate() {
        ValidationProvider provider = ValidationAdapters.jakartaBeanValidation(
                value -> List.of("blocked by bean policy"));
        String text = "{\"formatVersion\":1,\"records\":[{\"table\":\"notes\","
                + "\"recordId\":\"n1\",\"payload\":{\"updatedAt\":\"1\"}}]}";
        try {
            EnvelopeValidator.parse(text, new StrictJsonDecoder(), List.of(provider));
            throw new AssertionError("provider should veto a valid envelope");
        } catch (ValidationException expected) {
            if (expected.issues().stream().noneMatch(
                    issue -> issue.provider().equals("jakarta-validation"))) {
                throw new AssertionError("provider name was not preserved", expected);
            }
        }
    }

    private static void testProviderAudit() {
        Object decoded = Map.of("formatVersion", 1, "records", List.of());
        ValidationProvider provider = ValidationAdapters.networkntJsonSchema(value -> List.of());
        EnvelopeValidator.ProviderAuditResult audit = EnvelopeValidator.auditProvider(decoded, provider);
        if (!audit.drift() || audit.canonicalAccepted() || !audit.providerAccepted()) {
            throw new AssertionError("unexpected audit result: " + audit);
        }
    }

    private static void testReflectiveDecoders() throws Exception {
        FakeJackson mapper = new FakeJackson();
        Object decoded = ReflectiveJsonDecoders.jackson(mapper).decode("{}");
        if (!(decoded instanceof Map<?, ?>)) {
            throw new AssertionError("Jackson adapter did not invoke readValue");
        }
        FakeGson gson = new FakeGson();
        decoded = ReflectiveJsonDecoders.gson(gson).decode("{}");
        if (!(decoded instanceof Map<?, ?>)) {
            throw new AssertionError("Gson adapter did not invoke fromJson");
        }
    }

    private static void expectValidationFailure(Runnable action) {
        boolean rejected = false;
        try {
            action.run();
        } catch (ValidationException expected) {
            rejected = true;
        }
        if (!rejected) {
            throw new AssertionError("expected validation failure");
        }
    }

    public static final class FakeJackson {
        public Object readValue(String text, Class<?> type) {
            return Map.of();
        }
    }

    public static final class FakeGson {
        public Object fromJson(String text, Class<?> type) {
            return Map.of();
        }
    }
}
