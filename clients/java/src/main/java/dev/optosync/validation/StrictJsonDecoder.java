package dev.optosync.validation;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small strict RFC-8259 decoder used when applications do not supply Jackson or Gson. */
public final class StrictJsonDecoder implements JsonDecoder {
    private static final int MAX_DEPTH = 128;

    @Override
    public Object decode(String text) {
        if (text == null) {
            throw new IllegalArgumentException("JSON text must not be null");
        }
        Parser parser = new Parser(text);
        Object value = parser.parseValue(0);
        parser.skipWhitespace();
        if (!parser.atEnd()) {
            throw parser.error("unexpected trailing content");
        }
        return value;
    }

    private static final class Parser {
        private final String input;
        private int index;

        private Parser(String input) {
            this.input = input;
        }

        private Object parseValue(int depth) {
            if (depth > MAX_DEPTH) {
                throw error("maximum nesting depth exceeded");
            }
            skipWhitespace();
            if (atEnd()) {
                throw error("unexpected end of JSON");
            }
            return switch (peek()) {
                case '{' -> parseObject(depth + 1);
                case '[' -> parseArray(depth + 1);
                case '"' -> parseString();
                case 't' -> parseLiteral("true", Boolean.TRUE);
                case 'f' -> parseLiteral("false", Boolean.FALSE);
                case 'n' -> parseLiteral("null", null);
                default -> parseNumber();
            };
        }

        private Map<String, Object> parseObject(int depth) {
            consume('{');
            skipWhitespace();
            Map<String, Object> object = new LinkedHashMap<>();
            if (tryConsume('}')) {
                return object;
            }
            while (true) {
                skipWhitespace();
                if (atEnd() || peek() != '"') {
                    throw error("object key must be a string");
                }
                String key = parseString();
                skipWhitespace();
                consume(':');
                Object value = parseValue(depth);
                object.put(key, value);
                skipWhitespace();
                if (tryConsume('}')) {
                    return object;
                }
                consume(',');
            }
        }

        private List<Object> parseArray(int depth) {
            consume('[');
            skipWhitespace();
            List<Object> values = new ArrayList<>();
            if (tryConsume(']')) {
                return values;
            }
            while (true) {
                values.add(parseValue(depth));
                skipWhitespace();
                if (tryConsume(']')) {
                    return values;
                }
                consume(',');
            }
        }

        private String parseString() {
            consume('"');
            StringBuilder output = new StringBuilder();
            while (!atEnd()) {
                char character = input.charAt(index++);
                if (character == '"') {
                    return output.toString();
                }
                if (character == '\\') {
                    if (atEnd()) {
                        throw error("unfinished string escape");
                    }
                    char escape = input.charAt(index++);
                    switch (escape) {
                        case '"', '\\', '/' -> output.append(escape);
                        case 'b' -> output.append('\b');
                        case 'f' -> output.append('\f');
                        case 'n' -> output.append('\n');
                        case 'r' -> output.append('\r');
                        case 't' -> output.append('\t');
                        case 'u' -> output.append(parseUnicodeEscape());
                        default -> throw error("invalid string escape");
                    }
                } else {
                    if (character < 0x20) {
                        throw error("unescaped control character in string");
                    }
                    output.append(character);
                }
            }
            throw error("unterminated string");
        }

        private char parseUnicodeEscape() {
            if (index + 4 > input.length()) {
                throw error("short Unicode escape");
            }
            int value = 0;
            for (int count = 0; count < 4; count++) {
                int digit = Character.digit(input.charAt(index++), 16);
                if (digit < 0) {
                    throw error("invalid Unicode escape");
                }
                value = (value << 4) | digit;
            }
            return (char) value;
        }

        private Object parseLiteral(String literal, Object value) {
            if (!input.startsWith(literal, index)) {
                throw error("invalid literal");
            }
            index += literal.length();
            return value;
        }

        private BigDecimal parseNumber() {
            int start = index;
            if (tryConsume('-') && atEnd()) {
                throw error("incomplete number");
            }
            if (tryConsume('0')) {
                if (!atEnd() && Character.isDigit(peek())) {
                    throw error("leading zero in number");
                }
            } else {
                requireDigits();
            }
            if (tryConsume('.')) {
                requireDigits();
            }
            if (tryConsume('e') || tryConsume('E')) {
                if (!tryConsume('+')) {
                    tryConsume('-');
                }
                requireDigits();
            }
            try {
                return new BigDecimal(input.substring(start, index));
            } catch (NumberFormatException error) {
                throw error("invalid number");
            }
        }

        private void requireDigits() {
            int start = index;
            while (!atEnd() && Character.isDigit(peek())) {
                index++;
            }
            if (start == index) {
                throw error("expected digit");
            }
        }

        private void skipWhitespace() {
            while (!atEnd()) {
                char character = peek();
                if (character == ' ' || character == '\n' || character == '\r' || character == '\t') {
                    index++;
                } else {
                    return;
                }
            }
        }

        private void consume(char expected) {
            if (atEnd() || input.charAt(index) != expected) {
                throw error("expected '" + expected + "'");
            }
            index++;
        }

        private boolean tryConsume(char expected) {
            if (!atEnd() && input.charAt(index) == expected) {
                index++;
                return true;
            }
            return false;
        }

        private char peek() {
            return input.charAt(index);
        }

        private boolean atEnd() {
            return index >= input.length();
        }

        private IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " at character " + index);
        }
    }
}
