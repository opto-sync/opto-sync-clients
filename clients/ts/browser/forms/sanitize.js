const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TRANSIENT_NAMES = new Set([
    'authorization',
    'cfturnstileresponse',
    'csrf',
    'csrftoken',
    'grecaptcharesponse',
    'password',
    'passcode',
    'secret',
    'turnstiletoken',
    'accesstoken',
    'refreshtoken',
]);
function normalized(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function transientNames(extra) {
    const names = new Set(TRANSIENT_NAMES);
    if (extra)
        for (const name of extra)
            names.add(normalized(name));
    return names;
}
export function isTransientFormField(name, extra) {
    const value = normalized(name);
    if (transientNames(extra).has(value))
        return true;
    return (value.endsWith('password') ||
        value.endsWith('passcode') ||
        value.endsWith('secret') ||
        value.endsWith('token') ||
        value.includes('turnstile') ||
        value.includes('recaptcha'));
}
function fileLike(value) {
    if (typeof File !== 'undefined' && value instanceof File)
        return true;
    return Boolean(value &&
        typeof value === 'object' &&
        typeof value.name === 'string' &&
        typeof value.size === 'number' &&
        typeof value.type === 'string');
}
function fileDescriptor(file) {
    return {
        name: file.name,
        size: file.size,
        type: file.type,
        ...(typeof file.lastModified === 'number'
            ? { lastModified: file.lastModified }
            : {}),
    };
}
/** Deep JSON clone that removes transport-only credentials and file bytes. */
export function sanitizeFormPayload(value, options = {}) {
    const names = transientNames(options.transientFieldNames);
    const seen = new WeakSet();
    const visit = (candidate, key) => {
        if (key && isTransientFormField(key, names))
            return undefined;
        if (candidate === null || ['string', 'boolean'].includes(typeof candidate)) {
            return candidate;
        }
        if (typeof candidate === 'number') {
            if (!Number.isFinite(candidate))
                throw new TypeError('form numbers must be finite');
            return candidate;
        }
        if (candidate === undefined || ['function', 'symbol'].includes(typeof candidate)) {
            return undefined;
        }
        if (typeof candidate === 'bigint') {
            throw new TypeError('form BigInt values are not JSON-compatible');
        }
        if (candidate instanceof Date)
            return candidate.toISOString();
        if (fileLike(candidate)) {
            return options.includeFileMetadata ? fileDescriptor(candidate) : undefined;
        }
        if (typeof Blob !== 'undefined' && candidate instanceof Blob)
            return undefined;
        if (typeof candidate !== 'object')
            return undefined;
        if (seen.has(candidate))
            throw new TypeError('form payload must not contain cycles');
        seen.add(candidate);
        try {
            if (Array.isArray(candidate)) {
                return candidate.map((item) => visit(item)).filter((item) => item !== undefined);
            }
            const result = {};
            for (const [name, child] of Object.entries(candidate)) {
                if (BLOCKED_KEYS.has(name))
                    continue;
                const sanitized = visit(child, name);
                if (sanitized !== undefined)
                    result[name] = sanitized;
            }
            return result;
        }
        finally {
            seen.delete(candidate);
        }
    };
    return visit(value);
}
function append(fields, name, value) {
    const current = fields[name];
    fields[name] = current === undefined
        ? value
        : Array.isArray(current)
            ? [...current, value]
            : [current, value];
}
export function serializeFormData(data, options = {}) {
    const fields = {};
    const files = {};
    for (const [name, value] of data.entries()) {
        if (isTransientFormField(name, options.transientFieldNames))
            continue;
        if (typeof value === 'string')
            append(fields, name, value);
        else if (options.includeFileMetadata && fileLike(value) && value.size > 0) {
            (files[name] ??= []).push(fileDescriptor(value));
        }
    }
    return { fields, ...(Object.keys(files).length ? { files } : {}) };
}
export function safeFormUrl(raw) {
    if (!raw)
        return undefined;
    try {
        const base = typeof document === 'undefined' ? 'https://localhost/' : document.baseURI;
        const url = new URL(raw, base);
        if (!['http:', 'https:'].includes(url.protocol))
            return undefined;
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString();
    }
    catch {
        return undefined;
    }
}
