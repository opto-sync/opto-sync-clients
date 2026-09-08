import { DEFAULT_FORM_TABLE, DEFAULT_MUTATION_ID_FIELD, DEFAULT_SUBMISSION_ID_FIELD, FORM_SCHEMA_VERSION, FORM_SYNC_STATUS, } from './types.js';
import { safeFormUrl, sanitizeFormPayload, serializeFormData } from './sanitize.js';
function required(value, label) {
    const result = value?.trim();
    if (!result)
        throw new Error(`${label} must not be blank`);
    return result;
}
function randomId() {
    if (globalThis.crypto?.randomUUID)
        return globalThis.crypto.randomUUID();
    if (globalThis.crypto?.getRandomValues) {
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
            .slice(6, 8)
            .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }
    throw new Error('opto-sync forms require secure randomness');
}
function identity(options) {
    const now = options.now?.() ?? new Date();
    if (Number.isNaN(now.getTime()))
        throw new TypeError('now() returned an invalid Date');
    return {
        submissionId: required(options.submissionId ?? (options.randomId ?? randomId)(), 'submissionId'),
        tableName: required(options.tableName ?? DEFAULT_FORM_TABLE, 'tableName'),
        queuedAt: now.toISOString(),
        mode: options.mode ?? 'manual',
    };
}
function selectedFormName(form, configured) {
    return required(configured ?? form.dataset?.optoSyncForm ?? form.getAttribute?.('name') ?? form.id, 'formName');
}
function escaped(value) {
    return globalThis.CSS?.escape?.(value) ?? value.replace(/[\\"]/g, '\\$&');
}
function hidden(form, name, value) {
    let input = form.querySelector?.(`[name="${escaped(name)}"]`);
    if (!input) {
        input = form.ownerDocument.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.append(input);
    }
    input.value = value;
}
function emit(form, name, detail) {
    if (typeof CustomEvent !== 'undefined') {
        form.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }
}
function terminal(status) {
    return status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
function status(result) {
    return {
        ok: Boolean(result.ok),
        ...(typeof result.status === 'number' ? { status: result.status } : {}),
    };
}
async function mark(queue, id, value) {
    await queue.markMutation?.(id, value);
}
export async function queueFormPayload(queue, options) {
    const resolved = identity(options);
    const sourceUrl = safeFormUrl(options.sourceUrl);
    const action = safeFormUrl(options.action);
    const envelope = {
        schemaVersion: FORM_SCHEMA_VERSION,
        submissionId: resolved.submissionId,
        formName: required(options.formName, 'formName'),
        mode: resolved.mode,
        queuedAt: resolved.queuedAt,
        createdAt: resolved.queuedAt,
        updatedAt: resolved.queuedAt,
        ...(action ? { action } : {}),
        ...(options.method ? { method: options.method.toUpperCase() } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        payload: sanitizeFormPayload(options.payload, options),
    };
    const queueId = await queue.queueMutation(resolved.tableName, resolved.submissionId, envelope, options.protocol);
    return { queueId, submissionId: resolved.submissionId, tableName: resolved.tableName, envelope };
}
export async function queueFormSubmission(queue, form, options = {}) {
    const field = options.submissionIdField ?? DEFAULT_SUBMISSION_ID_FIELD;
    const current = form.querySelector?.(`[name="${escaped(field)}"]`)
        ?.value?.trim();
    const submissionId = options.submissionId ?? current ?? (options.randomId ?? randomId)();
    hidden(form, field, submissionId);
    const data = (options.formDataFactory ?? ((target) => new FormData(target)))(form);
    const serialized = serializeFormData(data, options);
    const formName = selectedFormName(form, options.formName);
    const resolved = identity({ ...options, formName, submissionId, mode: options.mode ?? 'native' });
    const action = safeFormUrl(form.action || form.getAttribute?.('action') || undefined);
    const sourceUrl = safeFormUrl(typeof location === 'undefined' ? undefined : location.href);
    const envelope = {
        schemaVersion: FORM_SCHEMA_VERSION,
        submissionId: resolved.submissionId,
        formName,
        mode: resolved.mode,
        queuedAt: resolved.queuedAt,
        createdAt: resolved.queuedAt,
        updatedAt: resolved.queuedAt,
        ...(action ? { action } : {}),
        method: (form.method || 'POST').toUpperCase(),
        ...(sourceUrl ? { sourceUrl } : {}),
        fields: serialized.fields,
        ...(serialized.files ? { files: serialized.files } : {}),
    };
    const queueId = await queue.queueMutation(resolved.tableName, resolved.submissionId, envelope, options.protocol);
    return { queueId, submissionId: resolved.submissionId, tableName: resolved.tableName, envelope };
}
export function bindNativeForm(queue, form, options) {
    let active = true;
    let inFlight = false;
    let replaying = false;
    const listener = async (raw) => {
        if (!active)
            return;
        if (replaying) {
            replaying = false;
            return;
        }
        const event = raw;
        event.preventDefault();
        if (inFlight)
            return;
        inFlight = true;
        const submitter = event.submitter ?? null;
        try {
            const queued = await queueFormSubmission(queue, form, { ...options, mode: 'native' });
            emit(form, 'opto-sync:form-queued', queued);
            const result = await options.submit({ ...queued, form, event, submitter });
            const outcome = status(result);
            if (outcome.ok) {
                await mark(queue, queued.queueId, FORM_SYNC_STATUS.SYNCED);
                emit(form, 'opto-sync:form-synced', { ...queued, result });
            }
            else if (terminal(outcome.status)) {
                await mark(queue, queued.queueId, FORM_SYNC_STATUS.FAILED);
                emit(form, 'opto-sync:form-rejected', { ...queued, result });
            }
            else
                emit(form, 'opto-sync:form-pending', { ...queued, result });
        }
        catch (error) {
            emit(form, 'opto-sync:form-error', { error });
            if (options.failOpen) {
                replaying = true;
                try {
                    form.requestSubmit(submitter && 'form' in submitter && submitter.form === form
                        ? submitter
                        : undefined);
                }
                catch {
                    replaying = false;
                    form.submit();
                }
            }
        }
        finally {
            inFlight = false;
        }
    };
    form.addEventListener('submit', listener);
    return () => {
        active = false;
        form.removeEventListener('submit', listener);
    };
}
export function bindHtmxForm(queue, form, options = {}) {
    let active = true;
    let replaying = false;
    let queueing = false;
    let pending;
    let settling = false;
    const completedRequests = new WeakSet();
    const replay = (submitter) => {
        replaying = true;
        try {
            form.requestSubmit(submitter && 'form' in submitter && submitter.form === form
                ? submitter
                : undefined);
        }
        catch {
            replaying = false;
            throw new Error('unable to replay HTMX form submission');
        }
    };
    const submit = async (raw) => {
        if (!active)
            return;
        if (replaying) {
            replaying = false;
            return;
        }
        const event = raw;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (queueing || pending !== undefined)
            return;
        queueing = true;
        const submitter = event.submitter ?? null;
        try {
            const queued = await queueFormSubmission(queue, form, { ...options, mode: 'htmx' });
            pending = queued.queueId;
            hidden(form, options.mutationIdField ?? DEFAULT_MUTATION_ID_FIELD, String(pending));
            emit(form, 'opto-sync:form-queued', queued);
            replay(submitter);
        }
        catch (error) {
            // A failed replay leaves durable intent pending, but must release the UI gate.
            pending = undefined;
            emit(form, 'opto-sync:form-error', { error });
            if (options.failOpen)
                replay(submitter);
        }
        finally {
            queueing = false;
        }
    };
    const after = async (raw) => {
        if (!active || pending === undefined || settling)
            return;
        const detail = raw.detail;
        const xhr = detail?.xhr;
        // responseError and afterRequest may describe the same request. Remember its
        // identity so a late duplicate cannot acknowledge a subsequent submission.
        if (xhr && completedRequests.has(xhr))
            return;
        if (xhr)
            completedRequests.add(xhr);
        const queueId = pending;
        const code = xhr?.status;
        settling = true;
        try {
            if (detail?.successful || (code !== undefined && code >= 200 && code < 300)) {
                await mark(queue, queueId, FORM_SYNC_STATUS.SYNCED);
                emit(form, 'opto-sync:form-synced', { queueId });
            }
            else if (terminal(code)) {
                await mark(queue, queueId, FORM_SYNC_STATUS.FAILED);
                emit(form, 'opto-sync:form-rejected', { queueId, status: code });
            }
            else {
                emit(form, 'opto-sync:form-pending', { queueId, status: code });
            }
        }
        catch (error) {
            emit(form, 'opto-sync:form-error', { error });
        }
        finally {
            // In-flight state is not durable queue state. Ambiguous transport or a
            // failed acknowledgement must remain queued without disabling the form.
            pending = undefined;
            settling = false;
        }
    };
    form.addEventListener('submit', submit, { capture: true });
    form.addEventListener('htmx:afterRequest', after);
    form.addEventListener('htmx:responseError', after);
    return () => {
        active = false;
        form.removeEventListener('submit', submit, { capture: true });
        form.removeEventListener('htmx:afterRequest', after);
        form.removeEventListener('htmx:responseError', after);
    };
}
export function createFormConnector(queue) {
    return {
        queuePayload: (options) => queueFormPayload(queue, options),
        queueForm: (form, options) => queueFormSubmission(queue, form, options),
        bindNative: (form, options) => bindNativeForm(queue, form, options),
        bindHtmx: (form, options) => bindHtmxForm(queue, form, options),
    };
}
