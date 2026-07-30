/**
 * Envelope validation (zod) + ingestion.
 *
 * The single source of truth for the envelope shape is
 * `opto-sync-clients/schema/opto-sync-envelope.schema.json`; the zod schema
 * here MUST accept/reject exactly the shared fixture corpus in
 * `schema/fixtures/` (enforced by test/schema-ingest.test.mjs). The Dart,
 * Rust, and Gleam validators are held to the same corpus.
 *
 * Ingestion turns a validated file/blob into ordinary queued mutations, so
 * every store (IndexedDB here; SQLite via the Dart client; Postgres/Supabase
 * via the sync protocol) converges through the normal reconcile path — the
 * ingest API deliberately has no direct-to-database shortcut.
 */
import { z } from 'zod';

import type { OptoSyncClient } from '../client.js';
import type { JsonRecord } from '../reconcile-core.js';
import type { ProtocolSyncLoop } from '../sync-loop.js';
import { write, writeDelete, type Optimism, type WriteReceipt } from '../rx/write.js';

const timestampSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^[0-9]{1,20}$/, 'pure-digit timestamp string'),
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$/,
      'fixed-width ISO-8601 UTC (optionally with HLC suffixes)',
    ),
]);

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, 'SQL-safe table identifier');

const payloadSchema = z
  .object({
    updatedAt: timestampSchema,
    createdAt: timestampSchema.optional(),
    syncedAt: timestampSchema.optional(),
  })
  .passthrough();

const recordSchema = z
  .object({
    table: identifierSchema,
    recordId: z.string().min(1).max(512),
    operation: z.enum(['upsert', 'delete']).optional(),
    baseRevision: z.string().regex(/^(?:0|[1-9][0-9]*)$/).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((record, context) => {
    if ((record.operation ?? 'upsert') === 'delete') {
      if (Object.keys(record.payload).length !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload'],
          message: 'a delete record must carry an empty payload',
        });
      }
      return;
    }
    const parsed = payloadSchema.safeParse(record.payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ ...issue, path: ['payload', ...issue.path] });
      }
    }
  });

export const envelopeSchema = z
  .object({
    formatVersion: z.literal(1),
    source: z.string().max(200).optional(),
    records: z.array(recordSchema).min(1),
  })
  .strict();

export type IngestEnvelope = z.infer<typeof envelopeSchema>;

export class IngestValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `envelope failed validation: ${issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'IngestValidationError';
  }
}

/** Validate an envelope (parsed JSON, JSON string, or Blob/File). */
export async function parseEnvelope(
  input: unknown | string | { text(): Promise<string> },
): Promise<IngestEnvelope> {
  let candidate: unknown = input;
  if (typeof candidate === 'string') {
    candidate = JSON.parse(candidate);
  } else if (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { text?: unknown }).text === 'function'
  ) {
    candidate = JSON.parse(await (candidate as { text(): Promise<string> }).text());
  }
  const result = envelopeSchema.safeParse(candidate);
  if (!result.success) throw new IngestValidationError(result.error.issues);
  return result.data;
}

export interface IngestOptions {
  optimism?: Optimism;
  loop?: Pick<ProtocolSyncLoop, 'hint' | 'syncNow'>;
}

export interface IngestResult {
  envelope: IngestEnvelope;
  receipts: WriteReceipt[];
}

/**
 * Validate and queue every record of an envelope. All-or-nothing at the
 * validation boundary (nothing queues if any record is invalid); queueing is
 * then per-record through the standard optimism-level write path, in file
 * order, so an interrupted ingest resumes idempotently server-side via
 * (clientId, mutationId) dedupe.
 */
export async function ingestEnvelope(
  client: OptoSyncClient,
  input: unknown | string | { text(): Promise<string> },
  options: IngestOptions = {},
): Promise<IngestResult> {
  const envelope = await parseEnvelope(input);
  const receipts: WriteReceipt[] = [];
  for (const record of envelope.records) {
    if ((record.operation ?? 'upsert') === 'delete') {
      receipts.push(
        await writeDelete(client, record.table, record.recordId, {
          optimism: options.optimism,
          loop: options.loop,
          protocol: { baseRevision: record.baseRevision },
        }),
      );
    } else {
      receipts.push(
        await write(
          client,
          record.table,
          record.recordId,
          record.payload as JsonRecord,
          {
            optimism: options.optimism,
            loop: options.loop,
            protocol: { baseRevision: record.baseRevision },
          },
        ),
      );
    }
  }
  return { envelope, receipts };
}
