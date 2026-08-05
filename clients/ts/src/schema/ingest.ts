/**
 * Envelope validation (Zod) + ingestion.
 *
 * The single source of truth for the envelope shape is
 * `opto-sync-clients/schema/opto-sync-envelope.schema.json`. The canonical
 * Zod validator and every optional provider MUST accept/reject exactly the
 * shared fixture corpus in `schema/fixtures/`.
 */
import { z } from 'zod';

import type { OptoSyncClient } from '../client.js';
import type { JsonRecord } from '../reconcile-core.js';
import type { ProtocolSyncLoop } from '../sync-loop.js';
import { write, writeDelete, type Optimism, type WriteReceipt } from '../rx/write.js';

export const MAX_SAFE_TIMESTAMP_INTEGER = Number.MAX_SAFE_INTEGER;

type ValidationPath = Array<string | number>;

export interface IngestValidationIssue {
  readonly code: string;
  readonly path: ValidationPath;
  readonly message: string;
  readonly provider?: string;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function boundedString(min: number, max: number, label: string) {
  return z.string().superRefine((value, context) => {
    const length = codePointLength(value);
    if (length < min || length > max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must contain ${min}..${max} Unicode code points`,
      });
    }
  });
}

const timestampSchema = z.union([
  z.number().int().nonnegative().max(MAX_SAFE_TIMESTAMP_INTEGER),
  z.string().regex(/^[0-9]{1,20}$/, 'pure-digit timestamp string'),
  // Native HLC, as emitted by formatHlc in ./clock.ts.
  z.string().regex(/^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$/, 'native HLC timestamp'),
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$/,
      'fixed-width ISO-8601 UTC (optionally with suffixes)',
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
    recordId: boundedString(1, 512, 'recordId'),
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
    source: boundedString(0, 200, 'source').optional(),
    records: z.array(recordSchema).min(1),
  })
  .strict();

export type IngestEnvelope = z.infer<typeof envelopeSchema>;

export class IngestValidationError extends Error {
  constructor(public readonly issues: readonly IngestValidationIssue[]) {
    super(
      `envelope failed validation: ${issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'IngestValidationError';
  }
}

export interface EnvelopeValidationProvider {
  readonly name: string;
  validate(value: unknown): ProviderResult | Promise<ProviderResult>;
}

export type ProviderResult =
  | { readonly success: true }
  | { readonly success: false; readonly issues: readonly IngestValidationIssue[] };

/** Minimal copy of Standard Schema v1, avoiding a runtime dependency. */
export interface StandardSchemaV1<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> },
    ) =>
      | { readonly value: Output; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<StandardSchemaIssue> }
      | Promise<
          | { readonly value: Output; readonly issues?: undefined }
          | { readonly issues: ReadonlyArray<StandardSchemaIssue> }
        >;
  };
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export interface AjvErrorLike {
  readonly instancePath?: string;
  readonly message?: string;
  readonly keyword?: string;
}

export interface AjvValidateFunction {
  (value: unknown): boolean | Promise<boolean>;
  readonly errors?: readonly AjvErrorLike[] | null;
}

function normalizePathSegment(segment: PropertyKey | { readonly key: PropertyKey }): string | number {
  const key =
    typeof segment === 'object' && segment !== null && 'key' in segment
      ? segment.key
      : segment;
  return typeof key === 'number' ? key : String(key);
}

function issue(
  provider: string,
  message: string,
  path: ValidationPath = [],
  code = 'custom',
): IngestValidationIssue {
  return { provider, message, path, code };
}

function zodIssues(issues: readonly z.ZodIssue[]): IngestValidationIssue[] {
  return issues.map((entry) => ({
    code: entry.code,
    path: [...entry.path],
    message: entry.message,
    provider: 'zod',
  }));
}

function pointerPath(pointer: string | undefined): ValidationPath {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^(?:0|[1-9][0-9]*)$/.test(part) ? Number(part) : part));
}

/**
 * Adapter for Valibot, ArkType, Yup, Joi, modern Zod, and every other library
 * that implements Standard Schema v1.
 */
export function standardSchemaProvider(
  schema: StandardSchemaV1,
  name = schema['~standard'].vendor,
): EnvelopeValidationProvider {
  return {
    name,
    async validate(value) {
      try {
        const result = await schema['~standard'].validate(value);
        if (!result.issues) return { success: true };
        return {
          success: false,
          issues: result.issues.map((entry) => ({
            code: 'standard_schema',
            provider: name,
            message: entry.message,
            path: entry.path?.map(normalizePathSegment) ?? [],
          })),
        };
      } catch (error) {
        return {
          success: false,
          issues: [issue(name, `provider threw: ${errorMessage(error)}`, [], 'provider_exception')],
        };
      }
    },
  };
}

/** Adapter for an Ajv-compatible compiled JSON Schema validation function. */
export function ajvProvider(
  validate: AjvValidateFunction,
  name = 'ajv',
): EnvelopeValidationProvider {
  return {
    name,
    async validate(value) {
      try {
        const accepted = await validate(value);
        if (accepted) return { success: true };
        const errors = validate.errors ?? [];
        return {
          success: false,
          issues:
            errors.length > 0
              ? errors.map((entry) =>
                  issue(
                    name,
                    entry.message ?? 'JSON Schema validation failed',
                    pointerPath(entry.instancePath),
                    entry.keyword ?? 'json_schema',
                  ),
                )
              : [issue(name, 'JSON Schema validation failed', [], 'json_schema')],
        };
      } catch (error) {
        return {
          success: false,
          issues: [issue(name, `provider threw: ${errorMessage(error)}`, [], 'provider_exception')],
        };
      }
    },
  };
}

/** Generic callback adapter for application-specific validators. */
export function callbackProvider(
  name: string,
  validate: (
    value: unknown,
  ) => void | readonly string[] | readonly IngestValidationIssue[] | Promise<void | readonly string[] | readonly IngestValidationIssue[]>,
): EnvelopeValidationProvider {
  return {
    name,
    async validate(value) {
      try {
        const found = await validate(value);
        if (!found || found.length === 0) return { success: true };
        const entries = found as readonly (string | IngestValidationIssue)[];
        const issues = entries.map((entry) =>
          typeof entry === 'string'
            ? issue(name, entry)
            : { ...entry, provider: entry.provider ?? name },
        );
        return { success: false, issues };
      } catch (error) {
        return {
          success: false,
          issues: [issue(name, `provider threw: ${errorMessage(error)}`, [], 'provider_exception')],
        };
      }
    },
  };
}

export interface ParseEnvelopeOptions {
  /** Additional veto gates. Zod always remains the canonical normalizer. */
  readonly validationProviders?: readonly EnvelopeValidationProvider[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerName(provider: unknown): string {
  try {
    if (provider === null || typeof provider !== 'object') return '<invalid-provider>';
    const name = (provider as { readonly name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : '<unnamed-provider>';
  } catch {
    return '<unreadable-provider>';
  }
}

function normalizeProviderIssue(name: string, entry: unknown): IngestValidationIssue {
  if (typeof entry === 'string') return issue(name, entry, [], 'provider_issue');
  if (entry === null || typeof entry !== 'object') {
    return issue(name, 'provider returned an invalid issue', [], 'provider_issue');
  }
  const candidate = entry as Partial<IngestValidationIssue>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'provider_issue',
    path: Array.isArray(candidate.path)
      ? candidate.path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
      : [],
    message: typeof candidate.message === 'string' ? candidate.message : 'validation failed',
    provider:
      typeof candidate.provider === 'string' && candidate.provider.length > 0
        ? candidate.provider
        : name,
  };
}

async function runProvider(
  provider: unknown,
  value: unknown,
): Promise<{ readonly name: string; readonly result: ProviderResult }> {
  const name = providerName(provider);
  try {
    if (
      provider === null ||
      typeof provider !== 'object' ||
      typeof (provider as { readonly validate?: unknown }).validate !== 'function'
    ) {
      throw new TypeError('provider does not expose validate(value)');
    }
    const raw: unknown = await (provider as EnvelopeValidationProvider).validate(value);
    if (raw === null || typeof raw !== 'object') {
      throw new TypeError('provider returned an invalid result');
    }
    const success = (raw as { readonly success?: unknown }).success;
    if (success === true) return { name, result: { success: true } };
    if (success !== false) throw new TypeError('provider result must contain boolean success');
    const rawIssues = (raw as { readonly issues?: unknown }).issues;
    if (!Array.isArray(rawIssues)) throw new TypeError('rejecting provider must return an issues array');
    return {
      name,
      result: {
        success: false,
        issues: rawIssues.map((entry) => normalizeProviderIssue(name, entry)),
      },
    };
  } catch (error) {
    return {
      name,
      result: {
        success: false,
        issues: [issue(name, `provider threw: ${errorMessage(error)}`, [], 'provider_exception')],
      },
    };
  }
}

async function decodeInput(input: unknown | string | { text(): Promise<string> }): Promise<unknown> {
  try {
    if (typeof input === 'string') return JSON.parse(input);
    if (
      input !== null &&
      typeof input === 'object' &&
      typeof (input as { text?: unknown }).text === 'function'
    ) {
      return JSON.parse(await (input as { text(): Promise<string> }).text());
    }
    return input;
  } catch (error) {
    throw new IngestValidationError([
      issue('json', `invalid JSON: ${errorMessage(error)}`, [], 'invalid_json'),
    ]);
  }
}

/** Validate an envelope (parsed JSON, JSON string, or Blob/File). */
export async function parseEnvelope(
  input: unknown | string | { text(): Promise<string> },
  options: ParseEnvelopeOptions = {},
): Promise<IngestEnvelope> {
  const candidate = await decodeInput(input);
  const canonical = envelopeSchema.safeParse(candidate);
  const issues = canonical.success ? [] : zodIssues(canonical.error.issues);
  let providerRejected = false;

  for (const provider of options.validationProviders ?? []) {
    const { name, result } = await runProvider(provider, candidate);
    if (!result.success) {
      providerRejected = true;
      if (result.issues.length === 0) {
        issues.push(issue(name, 'validation rejected the envelope', [], 'provider_rejected'));
      } else {
        issues.push(...result.issues);
      }
    }
  }

  if (!canonical.success || providerRejected) {
    throw new IngestValidationError(issues);
  }
  return canonical.data;
}

export interface ProviderAuditResult {
  readonly provider: string;
  readonly canonicalAccepted: boolean;
  readonly providerAccepted: boolean;
  readonly drift: boolean;
  readonly providerIssues: readonly IngestValidationIssue[];
}

/** Compare one provider's acceptance decision with the canonical Zod contract. */
export async function auditEnvelopeProvider(
  input: unknown | string | { text(): Promise<string> },
  provider: EnvelopeValidationProvider,
): Promise<ProviderAuditResult> {
  const candidate = await decodeInput(input);
  const canonicalAccepted = envelopeSchema.safeParse(candidate).success;
  const { name, result } = await runProvider(provider, candidate);
  const providerAccepted = result.success;
  return {
    provider: name,
    canonicalAccepted,
    providerAccepted,
    drift: canonicalAccepted !== providerAccepted,
    providerIssues: result.success ? [] : result.issues,
  };
}

export interface IngestOptions extends ParseEnvelopeOptions {
  optimism?: Optimism;
  loop?: Pick<ProtocolSyncLoop, 'hint' | 'syncNow'>;
}

export interface IngestResult {
  envelope: IngestEnvelope;
  receipts: WriteReceipt[];
}

/**
 * Validate and queue every record of an envelope. All-or-nothing at the
 * validation boundary; queueing is then per-record through the standard write
 * path, in file order.
 */
export async function ingestEnvelope(
  client: OptoSyncClient,
  input: unknown | string | { text(): Promise<string> },
  options: IngestOptions = {},
): Promise<IngestResult> {
  const envelope = await parseEnvelope(input, options);
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
