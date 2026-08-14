<?php

declare(strict_types=1);

namespace ZedPkg\OptoSync;

use InvalidArgumentException;
use JsonException;
use RuntimeException;
use stdClass;

/**
 * Transport-neutral OptoSync protocol v1 queue.
 *
 * Persist exportQueue() in the same transaction as the application's
 * optimistic write. A transport should retain the exact encoded push body
 * until acknowledgePush() accepts the server response.
 */
final class Client
{
    private const MAX_PROTOCOL_BATCH = 100;
    private const MAX_POSTGRES_BIGINT = PHP_INT_MAX;

    /** @var list<array<string, mixed>> */
    private array $mutations = [];

    private int $nextMutationId = 1;
    private string $checkpoint = '0';

    public function __construct(
        public readonly string $baseUrl,
        public readonly ?string $bearerToken = null,
        private readonly ?string $clientId = null,
        private readonly int $maxPendingMutations = 10_000,
        private readonly int $maxPayloadBytes = 261_120,
    ) {
        if ($baseUrl === '') {
            throw new InvalidArgumentException('baseUrl must be non-empty');
        }
        if ($clientId === '') {
            throw new InvalidArgumentException('clientId must be non-empty when provided');
        }
        if ($maxPendingMutations < 1 || $maxPayloadBytes < 1) {
            throw new InvalidArgumentException('queue limits must be positive');
        }
    }

    public function clientId(): ?string
    {
        return $this->clientId;
    }

    /**
     * @param array<string, mixed>|stdClass $payload
     *
     * @throws JsonException
     */
    public function enqueueUpsert(
        string $table,
        string $recordId,
        array|stdClass $payload,
        ?string $baseRevision = null,
        bool $resurrect = false,
    ): string {
        $this->assertQueueIdentity();
        $this->assertCoordinates($table, $recordId, $baseRevision);
        if (is_array($payload) && array_is_list($payload)) {
            throw new InvalidArgumentException('upsert payload must be a JSON object');
        }

        $payloadJson = json_encode(
            $payload,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
        if (strlen($payloadJson) > $this->maxPayloadBytes) {
            throw new InvalidArgumentException('upsert payload exceeds the configured byte limit');
        }

        return $this->enqueue([
            'operation' => 'upsert',
            'table' => $table,
            'recordId' => $recordId,
            'payloadJson' => $payloadJson,
            'baseRevision' => $baseRevision,
            'resurrect' => $resurrect,
        ]);
    }

    public function enqueueDelete(
        string $table,
        string $recordId,
        ?string $baseRevision = null,
    ): string {
        $this->assertQueueIdentity();
        $this->assertCoordinates($table, $recordId, $baseRevision);

        return $this->enqueue([
            'operation' => 'delete',
            'table' => $table,
            'recordId' => $recordId,
            'baseRevision' => $baseRevision,
        ]);
    }

    /** @return list<array<string, mixed>> */
    public function pending(): array
    {
        return array_values(array_filter(
            $this->mutations,
            static fn (array $mutation): bool => $mutation['status'] === 'pending',
        ));
    }

    /** @return array{protocolVersion: 1, clientId: string, mutations: list<array<string, mixed>>} */
    public function buildPushRequest(int $limit = self::MAX_PROTOCOL_BATCH): array
    {
        $clientId = $this->requireClientId();
        if ($limit < 1 || $limit > self::MAX_PROTOCOL_BATCH) {
            throw new InvalidArgumentException('limit must be between 1 and 100');
        }

        $pending = array_slice($this->pending(), 0, $limit);
        $protocolMutations = [];
        $priorId = null;
        foreach ($pending as $row) {
            $mutationId = (string) $row['mutationId'];
            if ($priorId !== null && (int) $mutationId !== $priorId + 1) {
                throw new RuntimeException('pending mutations must be contiguous and insertion ordered');
            }
            $priorId = (int) $mutationId;

            $mutation = [
                'mutationId' => $mutationId,
                'operation' => $row['operation'],
                'table' => $row['table'],
                'recordId' => $row['recordId'],
            ];
            if ($row['baseRevision'] !== null) {
                $mutation['baseRevision'] = $row['baseRevision'];
            }
            if ($row['operation'] === 'upsert') {
                $decoded = json_decode($row['payloadJson'], false, 512, JSON_THROW_ON_ERROR);
                if (!$decoded instanceof stdClass) {
                    throw new RuntimeException("mutation {$mutationId} payload is not a JSON object");
                }
                $mutation['payload'] = $decoded;
                if ($row['resurrect'] === true) {
                    $mutation['resurrect'] = true;
                }
            }
            $protocolMutations[] = $mutation;
        }

        return [
            'protocolVersion' => 1,
            'clientId' => $clientId,
            'mutations' => $protocolMutations,
        ];
    }

    /** @throws JsonException */
    public function encodePushRequest(int $limit = self::MAX_PROTOCOL_BATCH): string
    {
        return json_encode(
            $this->buildPushRequest($limit),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
    }

    /**
     * Accept an acknowledgement only when it proves coverage of the exact
     * immutable request. Returns the number of rows removed from the retry set.
     *
     * @param array<string, mixed> $request
     * @param array<string, mixed> $response
     */
    public function acknowledgePush(array $request, array $response): int
    {
        $this->validatePushResponse($request, $response);
        $expected = $this->buildPushRequest(count($request['mutations']));
        $jsonFlags = JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
        if (json_encode($expected, $jsonFlags) !== json_encode($request, $jsonFlags)) {
            throw new RuntimeException('push acknowledgement does not match the current pending batch');
        }

        $statusById = [];
        foreach ($response['results'] as $result) {
            $statusById[$result['mutationId']] = $result['status'];
        }
        foreach ($this->mutations as &$mutation) {
            $id = (string) $mutation['mutationId'];
            if (isset($statusById[$id])) {
                $mutation['status'] = $statusById[$id];
            }
        }
        unset($mutation);
        $this->checkpoint = $response['checkpoint'];

        return count($statusById);
    }

    /** @return array<string, mixed> */
    public function exportQueue(): array
    {
        return [
            'schemaVersion' => 1,
            'clientId' => $this->requireClientId(),
            'nextMutationId' => (string) $this->nextMutationId,
            'checkpoint' => $this->checkpoint,
            'mutations' => $this->mutations,
        ];
    }

    /** @param array<string, mixed> $snapshot */
    public function restoreQueue(array $snapshot): void
    {
        if (
            ($snapshot['schemaVersion'] ?? null) !== 1
            || ($snapshot['clientId'] ?? null) !== $this->requireClientId()
            || !self::isSafePositiveIntegerString($snapshot['nextMutationId'] ?? null)
            || !self::isCanonicalDecimal($snapshot['checkpoint'] ?? null)
            || !is_array($snapshot['mutations'] ?? null)
        ) {
            throw new InvalidArgumentException('invalid or foreign queue snapshot');
        }

        $restored = [];
        $priorId = 0;
        $pendingCount = 0;
        foreach ($snapshot['mutations'] as $row) {
            if (!is_array($row) || !self::isSafePositiveIntegerString($row['mutationId'] ?? null)) {
                throw new InvalidArgumentException('invalid mutation in queue snapshot');
            }
            $id = (int) $row['mutationId'];
            if ($id !== $priorId + 1 || !in_array($row['status'] ?? null, ['pending', 'applied', 'duplicate', 'rejected'], true)) {
                throw new InvalidArgumentException('queue snapshot mutations must be contiguous and valid');
            }
            if (
                !is_string($row['table'] ?? null)
                || $row['table'] === ''
                || !is_string($row['recordId'] ?? null)
                || $row['recordId'] === ''
                || !in_array($row['operation'] ?? null, ['upsert', 'delete'], true)
                || (($row['baseRevision'] ?? null) !== null && !self::isCanonicalDecimal($row['baseRevision']))
            ) {
                throw new InvalidArgumentException('queue snapshot contains invalid mutation coordinates');
            }
            if ($row['operation'] === 'upsert') {
                $payloadJson = $row['payloadJson'] ?? null;
                $payload = is_string($payloadJson) && strlen($payloadJson) <= $this->maxPayloadBytes
                    ? json_decode($payloadJson, false, 512, JSON_THROW_ON_ERROR)
                    : null;
                if (!$payload instanceof stdClass || !is_bool($row['resurrect'] ?? null)) {
                    throw new InvalidArgumentException('queue snapshot contains an invalid upsert payload');
                }
            } elseif (array_key_exists('payloadJson', $row) || array_key_exists('resurrect', $row)) {
                throw new InvalidArgumentException('queue snapshot delete contains upsert-only fields');
            }
            if ($row['status'] === 'pending') {
                $pendingCount++;
            }
            $priorId = $id;
            $restored[] = $row;
        }
        if ($pendingCount > $this->maxPendingMutations) {
            throw new InvalidArgumentException('queue snapshot exceeds the configured pending limit');
        }
        if ((int) $snapshot['nextMutationId'] !== $priorId + 1) {
            throw new InvalidArgumentException('queue snapshot next mutation id is inconsistent');
        }

        $this->mutations = $restored;
        $this->nextMutationId = (int) $snapshot['nextMutationId'];
        $this->checkpoint = $snapshot['checkpoint'];
    }

    /** @param array<string, mixed> $mutation */
    private function enqueue(array $mutation): string
    {
        if (count($this->pending()) >= $this->maxPendingMutations) {
            throw new RuntimeException('mutation queue is full');
        }
        if ($this->nextMutationId === self::MAX_POSTGRES_BIGINT) {
            throw new RuntimeException('mutation id space is exhausted');
        }

        $id = $this->nextMutationId++;
        $this->mutations[] = [
            'mutationId' => (string) $id,
            'status' => 'pending',
            ...$mutation,
        ];

        return (string) $id;
    }

    private function assertQueueIdentity(): void
    {
        $this->requireClientId();
    }

    private function requireClientId(): string
    {
        if ($this->clientId === null) {
            throw new RuntimeException('clientId is required for protocol queue operations');
        }

        return $this->clientId;
    }

    private function assertCoordinates(string $table, string $recordId, ?string $baseRevision): void
    {
        if ($table === '' || $recordId === '') {
            throw new InvalidArgumentException('table and recordId must be non-empty');
        }
        if ($baseRevision !== null && !self::isCanonicalDecimal($baseRevision)) {
            throw new InvalidArgumentException('baseRevision must be a canonical unsigned decimal string');
        }
    }

    /**
     * @param array<string, mixed> $request
     * @param array<string, mixed> $response
     */
    private function validatePushResponse(array $request, array $response): void
    {
        $requestMutations = $request['mutations'] ?? null;
        $results = $response['results'] ?? null;
        $lastRequestMutation = is_array($requestMutations) && $requestMutations !== []
            ? $requestMutations[array_key_last($requestMutations)]
            : null;

        if (
            ($request['protocolVersion'] ?? null) !== 1
            || !is_array($requestMutations)
            || $requestMutations === []
            || ($response['protocolVersion'] ?? null) !== 1
            || ($response['clientId'] ?? null) !== ($request['clientId'] ?? null)
            || !self::isCanonicalDecimal($response['lastMutationId'] ?? null)
            || !self::isCanonicalDecimal($response['checkpoint'] ?? null)
            || !is_array($results)
            || count($results) !== count($requestMutations)
            || ($response['lastMutationId'] ?? null) !== ($lastRequestMutation['mutationId'] ?? null)
        ) {
            throw new RuntimeException('push acknowledgement does not match the sent batch');
        }

        foreach ($requestMutations as $index => $mutation) {
            $result = $results[$index] ?? null;
            $status = is_array($result) ? ($result['status'] ?? null) : null;
            $originalStatus = is_array($result) ? ($result['originalStatus'] ?? null) : null;
            if (
                !is_array($mutation)
                || !is_array($result)
                || ($result['mutationId'] ?? null) !== ($mutation['mutationId'] ?? null)
                || !in_array($status, ['applied', 'duplicate', 'rejected'], true)
                || (isset($result['checkpoint']) && !self::isCanonicalDecimal($result['checkpoint']))
                || (isset($result['revision']) && !self::isCanonicalPositiveDecimal($result['revision']))
                || ($originalStatus !== null && !in_array($originalStatus, ['applied', 'rejected'], true))
                || (($status === 'duplicate') !== ($originalStatus !== null))
            ) {
                throw new RuntimeException('push acknowledgement does not match the sent batch');
            }
        }
    }

    private static function isCanonicalDecimal(mixed $value): bool
    {
        return is_string($value) && preg_match('/^(?:0|[1-9][0-9]*)$/D', $value) === 1;
    }

    private static function isCanonicalPositiveDecimal(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[1-9][0-9]*$/D', $value) === 1;
    }

    private static function isSafePositiveIntegerString(mixed $value): bool
    {
        if (!self::isCanonicalPositiveDecimal($value)) {
            return false;
        }
        $maximum = (string) self::MAX_POSTGRES_BIGINT;

        return strlen($value) < strlen($maximum)
            || (strlen($value) === strlen($maximum) && strcmp($value, $maximum) <= 0);
    }
}
