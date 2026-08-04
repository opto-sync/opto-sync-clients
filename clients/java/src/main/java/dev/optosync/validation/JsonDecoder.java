package dev.optosync.validation;

/** Decodes JSON text to maps, lists, strings, booleans, null, and Number values. */
@FunctionalInterface
public interface JsonDecoder {
    Object decode(String text) throws Exception;
}
