package dev.optosync.validation;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Objects;

/** Optional Jackson and Gson adapters without forcing either dependency. */
public final class ReflectiveJsonDecoders {
    private ReflectiveJsonDecoders() {}

    public static JsonDecoder jackson(Object objectMapper) {
        Objects.requireNonNull(objectMapper, "objectMapper");
        Method method = findMethod(objectMapper.getClass(), "readValue");
        return text -> invoke(method, objectMapper, text, Object.class);
    }

    public static JsonDecoder gson(Object gson) {
        Objects.requireNonNull(gson, "gson");
        Method method = findMethod(gson.getClass(), "fromJson");
        return text -> invoke(method, gson, text, Object.class);
    }

    private static Method findMethod(Class<?> type, String name) {
        try {
            return type.getMethod(name, String.class, Class.class);
        } catch (NoSuchMethodException error) {
            throw new IllegalArgumentException(
                    type.getName() + " does not expose " + name + "(String, Class)",
                    error);
        }
    }

    private static Object invoke(Method method, Object target, String text, Class<?> targetType)
            throws Exception {
        try {
            return method.invoke(target, text, targetType);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception exception) {
                throw exception;
            }
            if (cause instanceof Error fatal) {
                throw fatal;
            }
            throw new IllegalStateException(cause);
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("JSON decoder method is not accessible", error);
        }
    }
}
