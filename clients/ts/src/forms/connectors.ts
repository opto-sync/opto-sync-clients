import {
  DEFAULT_FORM_TABLE,
  DEFAULT_MUTATION_ID_FIELD,
  DEFAULT_SUBMISSION_ID_FIELD,
  FORM_SCHEMA_VERSION,
  FORM_SYNC_STATUS,
  type FormConnector,
  type FormEnvelope,
  type FormIdentityOptions,
  type FormMode,
  type FormMutationQueue,
  type HtmxFormConnectorOptions,
  type NativeFormConnectorOptions,
  type NativeSubmitResult,
  type QueueFormElementOptions,
  type QueueFormPayloadOptions,
  type QueuedFormSubmission,
} from './types.js';
import { safeFormUrl, sanitizeFormPayload, serializeFormData } from './sanitize.js';

function required(value: string | undefined, label: string): string {
  const result = value?.trim();
  if (!result) throw new Error(`${label} must not be blank`);
  return result;
}
function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
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
function identity(options: FormIdentityOptions): {
  submissionId: string;
  tableName: string;
  queuedAt: string;
  mode: FormMode;
} {
  const now = options.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError('now() returned an invalid Date');
  return {
    submissionId: required(
      options.submissionId ?? (options.randomId ?? randomId)(),
      'submissionId',
    ),
    tableName: required(options.tableName ?? DEFAULT_FORM_TABLE, 'tableName'),
    queuedAt: now.toISOString(),
    mode: options.mode ?? 'manual',
  };
}
function selectedFormName(form: HTMLFormElement, configured?: string): string {
  return required(
    configured ?? form.dataset?.optoSyncForm ?? form.getAttribute?.('name') ?? form.id,
    'formName',
  );
}
function escaped(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/[\\"]/g, '\\$&');
}
function hidden(form: HTMLFormElement, name: string, value: string): void {
  let input = form.querySelector?.(`[name="${escaped(name)}"]`) as HTMLInputElement | null;
  if (!input) {
    input = form.ownerDocument.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.append(input);
  }
  input.value = value;
}
function emit(form: HTMLFormElement, name: string, detail: unknown): void {
  if (typeof CustomEvent !== 'undefined') {
    form.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }
}
function terminal(status?: number): boolean {
  return status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
function status(result: NativeSubmitResult | Response): { ok: boolean; status?: number } {
  return {
    ok: Boolean(result.ok),
    ...(typeof result.status === 'number' ? { status: result.status } : {}),
  };
}
async function mark(queue: FormMutationQueue, id: number, value: number): Promise<void> {
  await queue.markMutation?.(id, value);
}

export async function queueFormPayload(
  queue: FormMutationQueue,
  options: QueueFormPayloadOptions,
): Promise<QueuedFormSubmission> {
  const resolved = identity(options);
  const sourceUrl = safeFormUrl(options.sourceUrl);
  const action = safeFormUrl(options.action);
  const envelope: FormEnvelope = {
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
  const queueId = await queue.queueMutation(
    resolved.tableName,
    resolved.submissionId,
    envelope,
    options.protocol,
  );
  return { queueId, submissionId: resolved.submissionId, tableName: resolved.tableName, envelope };
}

export async function queueFormSubmission(
  queue: FormMutationQueue,
  form: HTMLFormElement,
  options: QueueFormElementOptions = {},
): Promise<QueuedFormSubmission> {
  const field = options.submissionIdField ?? DEFAULT_SUBMISSION_ID_FIELD;
  const current = (form.querySelector?.(`[name="${escaped(field)}"]`) as HTMLInputElement | null)
    ?.value?.trim();
  const submissionId = options.submissionId ?? current ?? (options.randomId ?? randomId)();
  hidden(form, field, submissionId);
  const data = (options.formDataFactory ?? ((target) => new FormData(target)))(form);
  const serialized = serializeFormData(data, options);
  const formName = selectedFormName(form, options.formName);
  const resolved = identity({ ...options, formName, submissionId, mode: options.mode ?? 'native' });
  const action = safeFormUrl(form.action || form.getAttribute?.('action') || undefined);
  const sourceUrl = safeFormUrl(typeof location === 'undefined' ? undefined : location.href);
  const envelope: FormEnvelope = {
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
  const queueId = await queue.queueMutation(
    resolved.tableName,
    resolved.submissionId,
    envelope,
    options.protocol,
  );
  return { queueId, submissionId: resolved.submissionId, tableName: resolved.tableName, envelope };
}

export function bindNativeForm(
  queue: FormMutationQueue,
  form: HTMLFormElement,
  options: NativeFormConnectorOptions,
): () => void {
  let active = true;
  let inFlight = false;
  let replaying = false;
  const listener = async (raw: Event): Promise<void> => {
    if (!active) return;
    if (replaying) {
      replaying = false;
      return;
    }
    const event = raw as SubmitEvent;
    event.preventDefault();
    if (inFlight) return;
    inFlight = true;
    const submitter = (event.submitter as HTMLElement | null | undefined) ?? null;
    try {
      const queued = await queueFormSubmission(queue, form, { ...options, mode: 'native' });
      emit(form, 'opto-sync:form-queued', queued);
      const result = await options.submit({ ...queued, form, event, submitter });
      const outcome = status(result);
      if (outcome.ok) {
        await mark(queue, queued.queueId, FORM_SYNC_STATUS.SYNCED);
        emit(form, 'opto-sync:form-synced', { ...queued, result });
      } else if (terminal(outcome.status)) {
        await mark(queue, queued.queueId, FORM_SYNC_STATUS.FAILED);
        emit(form, 'opto-sync:form-rejected', { ...queued, result });
      } else emit(form, 'opto-sync:form-pending', { ...queued, result });
    } catch (error) {
      emit(form, 'opto-sync:form-error', { error });
      if (options.failOpen) {
        replaying = true;
        try {
          form.requestSubmit(
            submitter && 'form' in submitter && submitter.form === form
              ? (submitter as HTMLButtonElement | HTMLInputElement)
              : undefined,
          );
        } catch {
          replaying = false;
          form.submit();
        }
      }
    } finally {
      inFlight = false;
    }
  };
  form.addEventListener('submit', listener);
  return () => {
    active = false;
    form.removeEventListener('submit', listener);
  };
}

interface HtmxDetail {
  successful?: boolean;
  xhr?: { status?: number };
}
export function bindHtmxForm(
  queue: FormMutationQueue,
  form: HTMLFormElement,
  options: HtmxFormConnectorOptions = {},
): () => void {
  let active = true;
  let replaying = false;
  let queueing = false;
  let pending: number | undefined;
  const replay = (submitter: HTMLElement | null): void => {
    replaying = true;
    try {
      form.requestSubmit(
        submitter && 'form' in submitter && submitter.form === form
          ? (submitter as HTMLButtonElement | HTMLInputElement)
          : undefined,
      );
    } catch {
      replaying = false;
      throw new Error('unable to replay HTMX form submission');
    }
  };
  const submit = async (raw: Event): Promise<void> => {
    if (!active) return;
    if (replaying) {
      replaying = false;
      return;
    }
    const event = raw as SubmitEvent;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (queueing || pending !== undefined) return;
    queueing = true;
    const submitter = (event.submitter as HTMLElement | null | undefined) ?? null;
    try {
      const queued = await queueFormSubmission(queue, form, { ...options, mode: 'htmx' });
      pending = queued.queueId;
      hidden(form, options.mutationIdField ?? DEFAULT_MUTATION_ID_FIELD, String(pending));
      emit(form, 'opto-sync:form-queued', queued);
      replay(submitter);
    } catch (error) {
      emit(form, 'opto-sync:form-error', { error });
      if (options.failOpen) replay(submitter);
    } finally {
      queueing = false;
    }
  };
  const after = async (raw: Event): Promise<void> => {
    if (pending === undefined) return;
    const detail = (raw as CustomEvent<HtmxDetail>).detail;
    const code = detail?.xhr?.status;
    if (detail?.successful || (code !== undefined && code >= 200 && code < 300)) {
      await mark(queue, pending, FORM_SYNC_STATUS.SYNCED);
      emit(form, 'opto-sync:form-synced', { queueId: pending });
      pending = undefined;
    } else if (terminal(code)) {
      await mark(queue, pending, FORM_SYNC_STATUS.FAILED);
      emit(form, 'opto-sync:form-rejected', { queueId: pending, status: code });
      pending = undefined;
    }
  };
  form.addEventListener('submit', submit, { capture: true });
  form.addEventListener('htmx:afterRequest', after as EventListener);
  form.addEventListener('htmx:responseError', after as EventListener);
  return () => {
    active = false;
    form.removeEventListener('submit', submit, { capture: true });
    form.removeEventListener('htmx:afterRequest', after as EventListener);
    form.removeEventListener('htmx:responseError', after as EventListener);
  };
}

export function createFormConnector(queue: FormMutationQueue): FormConnector {
  return {
    queuePayload: (options) => queueFormPayload(queue, options),
    queueForm: (form, options) => queueFormSubmission(queue, form, options),
    bindNative: (form, options) => bindNativeForm(queue, form, options),
    bindHtmx: (form, options) => bindHtmxForm(queue, form, options),
  };
}
