<?php

declare(strict_types=1);

use ZedPkg\OptoSync\Client;

require dirname(__DIR__) . '/vendor/autoload.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @param class-string<Throwable> $exception */
function expectException(string $exception, callable $operation, string $message): void
{
    try {
        $operation();
    } catch (Throwable $error) {
        check($error instanceof $exception, $message . ': wrong exception ' . $error::class);
        return;
    }

    throw new RuntimeException($message . ': no exception thrown');
}

$legacy = new Client('https://sync.example.test', 'token');
check($legacy->baseUrl === 'https://sync.example.test', 'legacy baseUrl constructor contract changed');
check($legacy->bearerToken === 'token', 'legacy bearerToken constructor contract changed');
expectException(
    RuntimeException::class,
    fn (): string => $legacy->enqueueDelete('documents', 'doc-0'),
    'protocol operations must require a durable client identity',
);

$client = new Client('https://sync.example.test', null, 'php-e2e');
check(
    $client->enqueueUpsert(
        'documents',
        'doc-1',
        ['title' => 'offline'],
        baseRevision: '7',
        resurrect: true,
    ) === '1',
    'first mutation id is not one',
);
check($client->enqueueDelete('documents', 'doc-2') === '2', 'second mutation id is not two');

$expected = '{"protocolVersion":1,"clientId":"php-e2e","mutations":[{"mutationId":"1","operation":"upsert","table":"documents","recordId":"doc-1","baseRevision":"7","payload":{"title":"offline"},"resurrect":true},{"mutationId":"2","operation":"delete","table":"documents","recordId":"doc-2"}]}';
$firstBody = $client->encodePushRequest();
check($firstBody === $expected, 'protocol v1 body is not canonical');
check($client->encodePushRequest() === $firstBody, 'retry rebuilt a different request body');

$snapshot = $client->exportQueue();
$restored = new Client('https://sync.example.test', null, 'php-e2e');
$restored->restoreQueue($snapshot);
check($restored->encodePushRequest() === $firstBody, 'durable restore changed the retry body');

$foreignSnapshot = $snapshot;
$foreignSnapshot['clientId'] = 'another-installation';
expectException(
    InvalidArgumentException::class,
    fn (): null => $restored->restoreQueue($foreignSnapshot),
    'foreign durable queue was accepted',
);
$invalidPayloadSnapshot = $snapshot;
$invalidPayloadSnapshot['mutations'][0]['payloadJson'] = '[]';
expectException(
    InvalidArgumentException::class,
    fn (): null => $restored->restoreQueue($invalidPayloadSnapshot),
    'non-object durable payload was accepted',
);

$request = $client->buildPushRequest();
$badResponse = [
    'protocolVersion' => 1,
    'clientId' => 'php-e2e',
    'lastMutationId' => '3',
    'checkpoint' => '12',
    'results' => [],
];
expectException(
    RuntimeException::class,
    fn (): int => $client->acknowledgePush($request, $badResponse),
    'watermark beyond the immutable batch was accepted',
);
check(count($client->pending()) === 2, 'invalid acknowledgement discarded pending writes');

$response = [
    'protocolVersion' => 1,
    'clientId' => 'php-e2e',
    'lastMutationId' => '2',
    'checkpoint' => '12',
    'results' => [
        ['mutationId' => '1', 'status' => 'applied', 'checkpoint' => '11', 'revision' => '20'],
        [
            'mutationId' => '2',
            'status' => 'duplicate',
            'originalStatus' => 'applied',
            'checkpoint' => '12',
            'revision' => '21',
        ],
    ],
];
check($client->acknowledgePush($request, $response) === 2, 'acknowledged row count is wrong');
check($client->pending() === [], 'acknowledged mutations remained pending');
check($client->exportQueue()['checkpoint'] === '12', 'checkpoint did not advance');

$bounded = new Client('https://sync.example.test', null, 'bounded', maxPendingMutations: 1);
$bounded->enqueueDelete('documents', 'doc-1');
expectException(
    RuntimeException::class,
    fn (): string => $bounded->enqueueDelete('documents', 'doc-2'),
    'queue resource bound was not enforced',
);

fwrite(STDOUT, "PHP OptoSync contract passed\n");
