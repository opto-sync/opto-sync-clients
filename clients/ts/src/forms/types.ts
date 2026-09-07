export type FormJsonRecord = Record<string, unknown>;

export interface FormProtocolMutationOptions {
  baseRevision?: string;
  resurrect?: boolean;
  consistencyPolicy?: string;
}

export interface FormLocalMutation {
  id?: number;
  tableName: string;
  recordId: string;
  jsonPayload: string;
  createdAt?: number;
  syncStatus: number;
  operation?: 'upsert' | 'delete';
  baseRevision?: string;
  resurrect?: boolean;
  consistencyPolicy?: string;
  attempts?: number;
  lastError?: string;
}

/** Structural subset implemented by OptoSyncClient. */
export interface FormMutationQueue {
  queueMutation(
    tableName: string,
    recordId: string,
    payload: FormJsonRecord,
    protocol?: FormProtocolMutationOptions,
  ): Promise<number>;
  pendingMutations?(tableName?: string): Promise<FormLocalMutation[]>;
  markMutation?(id: number, syncStatus: number): Promise<void>;
}

export const FORM_SYNC_STATUS = Object.freeze({
  PENDING: 0,
  SYNCED: 1,
  FAILED: 2,
});
export const FORM_SCHEMA_VERSION = 'opto-sync.form.v1' as const;
export const DEFAULT_FORM_TABLE = 'form_submissions';
export const DEFAULT_SUBMISSION_ID_FIELD = '_opto_submission_id';
export const DEFAULT_MUTATION_ID_FIELD = '_opto_mutation_id';
export const DEFAULT_FORM_DATABASE = 'OptoSyncFormDatabase';
export const DEFAULT_FORM_STORE = 'formMutations';
export const DEFAULT_MAX_PENDING_FORMS = 1_000;
export const DEFAULT_MAX_FORM_PAYLOAD_BYTES = 255 * 1024;

export type FormMode = 'native' | 'htmx' | 'manual';
export interface FormFileDescriptor {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}
export interface FormEnvelope extends FormJsonRecord {
  schemaVersion: typeof FORM_SCHEMA_VERSION;
  submissionId: string;
  formName: string;
  mode: FormMode;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  action?: string;
  method?: string;
  sourceUrl?: string;
  fields?: Record<string, string | string[]>;
  files?: Record<string, FormFileDescriptor[]>;
  payload?: unknown;
}
export interface FormSanitizationOptions {
  transientFieldNames?: Iterable<string>;
  /** File metadata is opt-in. File bytes are never queued. */
  includeFileMetadata?: boolean;
}
export interface FormIdentityOptions {
  formName: string;
  tableName?: string;
  submissionId?: string;
  mode?: FormMode;
  protocol?: FormProtocolMutationOptions;
  transientFieldNames?: Iterable<string>;
  now?: () => Date;
  randomId?: () => string;
}
export interface QueueFormPayloadOptions extends FormIdentityOptions {
  payload: unknown;
  action?: string;
  method?: string;
  sourceUrl?: string;
}
export interface QueueFormElementOptions
  extends Omit<FormIdentityOptions, 'formName'>,
    FormSanitizationOptions {
  formName?: string;
  submissionIdField?: string;
  formDataFactory?: (form: HTMLFormElement) => FormData;
}
export interface QueuedFormSubmission {
  queueId: number;
  submissionId: string;
  tableName: string;
  envelope: FormEnvelope;
}
export interface NativeSubmitContext extends QueuedFormSubmission {
  form: HTMLFormElement;
  event: SubmitEvent;
  submitter: HTMLElement | null;
}
export interface NativeSubmitResult {
  ok: boolean;
  status?: number;
  receipt?: unknown;
}
export interface NativeFormConnectorOptions extends QueueFormElementOptions {
  submit(context: NativeSubmitContext): Promise<NativeSubmitResult | Response>;
  failOpen?: boolean;
}
export interface HtmxFormConnectorOptions extends QueueFormElementOptions {
  mutationIdField?: string;
  failOpen?: boolean;
}
export interface BrowserFormQueueOptions {
  databaseName?: string;
  maxPendingMutations?: number;
  maxQueuedPayloadBytes?: number;
}
export interface BrowserFormMutation extends FormLocalMutation {
  id?: number;
  createdAt: number;
  operation: 'upsert';
  attempts: number;
}
export interface FormConnector {
  queuePayload(options: QueueFormPayloadOptions): Promise<QueuedFormSubmission>;
  queueForm(
    form: HTMLFormElement,
    options?: QueueFormElementOptions,
  ): Promise<QueuedFormSubmission>;
  bindNative(
    form: HTMLFormElement,
    options: NativeFormConnectorOptions,
  ): () => void;
  bindHtmx(
    form: HTMLFormElement,
    options?: HtmxFormConnectorOptions,
  ): () => void;
}
