import * as z from 'zod';

import type {
  OptoSyncClient,
  QueueBatchMutation,
} from './client.js';
import {
  OptimismLevel,
  executeReactiveWrite,
  type ReactiveWriteResult,
} from './reactive.js';

export const SYNC_INGEST_FORMAT = 'opto-sync.ingest.v1' as const;
export const SYNC_INGEST_SCHEMA_ID =
  'https://opto-sync.dev/schemas/opto-sync-ingest.v1.schema.json';
export const DEFAULT_MAX_INGEST_BYTES = 16 * 1024 * 1024;

const scopeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const recordIdSchema = z.string().min(1).max(512);
const canonicalRevisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hlcTimestampSchema = z
  .string()
  .regex(/^[0-9]{13}-[0-9a-f]{4}-[A-Za-z0-9._:]+$/);
const decimalTimestampSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

/**
 * The source JSON Schema deliberately rejects JSON numbers for timestamps.
 * A decimal string survives JavaScript, Dart, Rust, Gleam, SQLite JSON, and
 * PostgreSQL JSONB without losing a 64-bit nanosecond value.
 */
export const syncTimestampSchema = z.union([
  hlcTimestampSchema,
  z.iso.datetime({ offset: true }),
  decimalTimestampSchema,
]);

export const syncIngestRecordSchema = z
  .object({
    updatedAt: syncTimestampSchema,
    createdAt: syncTimestampSchema.optional(),
    syncedAt: syncTimestampSchema.optional(),
  })
  .catchall(z.json());

const syncIngestUpsertSchema = z.strictObject({
  operation: z.literal('upsert'),
  table: scopeIdSchema,
  recordId: recordIdSchema,
  record: syncIngestRecordSchema,
  baseRevision: canonicalRevisionSchema.optional(),
  resurrect: z.boolean().optional(),
});

const syncIngestDeleteSchema = z.strictObject({
  operation: z.literal('delete'),
  table: scopeIdSchema,
  recordId: recordIdSchema,
  deletedAt: syncTimestampSchema,
  baseRevision: canonicalRevisionSchema.optional(),
});

export const syncIngestMutationSchema = z.discriminatedUnion('operation', [
  syncIngestUpsertSchema,
  syncIngestDeleteSchema,
]);

/**
 * Runtime mirror of `schemas/opto-sync-ingest.v1.schema.json`.
 *
 * The checked-in JSON Schema is the cross-language source of truth. Shared
 * valid/invalid fixtures are exercised against this Zod schema and the Dart,
 * Rust, and Gleam decoders to prevent validator drift.
 */
export const syncIngestDocumentSchema = z.strictObject({
  format: z.literal(SYNC_INGEST_FORMAT),
  batchId: scopeIdSchema,
  createdAt: syncTimestampSchema,
  mutations: z.array(syncIngestMutationSchema).min(1).max(10_000),
});

export type SyncTimestamp = z.infer<typeof syncTimestampSchema>;
export type SyncIngestRecord = z.infer<typeof syncIngestRecordSchema>;
export type SyncIngestMutation = z.infer<typeof syncIngestMutationSchema>;
export type SyncIngestDocument = z.infer<typeof syncIngestDocumentSchema>;

export type SyncIngestInput =
  | unknown
  | string
  | Blob
  | ArrayBuffer
  | ArrayBufferView;

export interface ParseSyncIngestOptions {
  maxBytes?: number;
}

export class SyncIngestValidationError extends Error {
  readonly issues: readonly {
    path: readonly PropertyKey[];
    message: string;
  }[];

  constructor(
    message: string,
    issues: readonly {
      path: readonly PropertyKey[];
      message: string;
    }[] = [],
  ) {
    super(message);
    this.name = 'SyncIngestValidationError';
    this.issues = issues;
  }
}

function assertMaxBytes(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new SyncIngestValidationError(
      `ingest document is ${bytes} bytes; limit is ${maxBytes}`,
    );
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SyncIngestValidationError(
      'ingest document is not valid UTF-8',
    );
  }
}

async function normalizeInput(
  input: SyncIngestInput,
  maxBytes: number,
): Promise<unknown> {
  if (
    typeof Blob === 'function' &&
    input instanceof Blob
  ) {
    assertMaxBytes(input.size, maxBytes);
    return JSON.parse(decodeUtf8(new Uint8Array(await input.arrayBuffer())));
  }
  if (input instanceof ArrayBuffer) {
    assertMaxBytes(input.byteLength, maxBytes);
    return JSON.parse(decodeUtf8(new Uint8Array(input)));
  }
  if (ArrayBuffer.isView(input)) {
    assertMaxBytes(input.byteLength, maxBytes);
    return JSON.parse(
      decodeUtf8(
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
      ),
    );
  }
  if (typeof input === 'string') {
    assertMaxBytes(new TextEncoder().encode(input).byteLength, maxBytes);
    return JSON.parse(input);
  }
  return input;
}

/**
 * Parse a JSON string, browser Blob/File, byte buffer, or already-decoded
 * object without writing to local storage.
 */
export async function parseSyncIngestDocument(
  input: SyncIngestInput,
  options: ParseSyncIngestOptions = {},
): Promise<SyncIngestDocument> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INGEST_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  let decoded: unknown;
  try {
    decoded = await normalizeInput(input, maxBytes);
  } catch (error) {
    if (error instanceof SyncIngestValidationError) throw error;
    throw new SyncIngestValidationError('ingest document is not valid JSON');
  }
  const result = syncIngestDocumentSchema.safeParse(decoded);
  if (!result.success) {
    throw new SyncIngestValidationError(
      'ingest document does not match opto-sync.ingest.v1',
      result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function toQueueMutation(
  mutation: SyncIngestMutation,
): QueueBatchMutation {
  if (mutation.operation === 'delete') {
    return {
      operation: 'delete',
      tableName: mutation.table,
      recordId: mutation.recordId,
      baseRevision: mutation.baseRevision,
    };
  }
  return {
    operation: 'upsert',
    tableName: mutation.table,
    recordId: mutation.recordId,
    payload: mutation.record,
    baseRevision: mutation.baseRevision,
    resurrect: mutation.resurrect,
  };
}

export interface IngestSyncDocumentOptions<RemoteResult> {
  input: SyncIngestInput;
  client: Pick<OptoSyncClient, 'queueBatch'>;
  optimism?: OptimismLevel;
  maxBytes?: number;
  /**
   * Required only for `ServerConfirmed`. Applications can POST the validated
   * document to their own authenticated ingest endpoint.
   */
  remoteIngest?: (
    document: Readonly<SyncIngestDocument>,
  ) => Promise<RemoteResult>;
  installRemote?: (result: RemoteResult) => Promise<void>;
  requestBackgroundSync?: () => void | Promise<void>;
  syncNow?: () => Promise<void>;
}

export interface IngestSyncDocumentResult<RemoteResult> {
  document: SyncIngestDocument;
  write: ReactiveWriteResult<RemoteResult, readonly number[]>;
}

/**
 * Validate the complete document, then apply the selected write strategy.
 *
 * Durable strategies use one atomic IndexedDB batch and leave protocol v1 to
 * carry the mutations to PostgreSQL/Supabase. Server-confirmed mode performs
 * no local queue write and requires an application-owned authenticated API.
 */
export async function ingestSyncDocument<RemoteResult = unknown>(
  options: IngestSyncDocumentOptions<RemoteResult>,
): Promise<IngestSyncDocumentResult<RemoteResult>> {
  const document = await parseSyncIngestDocument(options.input, {
    maxBytes: options.maxBytes,
  });
  const optimism = options.optimism ?? OptimismLevel.DurableLocal;
  const write = await executeReactiveWrite<
    RemoteResult,
    readonly number[]
  >({
    optimism,
    remoteWrite: async () => {
      if (!options.remoteIngest) {
        throw new TypeError(
          'server-confirmed ingest requires remoteIngest',
        );
      }
      return options.remoteIngest(document);
    },
    queueLocal: () =>
      options.client.queueBatch(document.mutations.map(toQueueMutation)),
    installRemote: options.installRemote,
    requestBackgroundSync: options.requestBackgroundSync,
    syncNow: options.syncNow,
  });
  return { document, write };
}
