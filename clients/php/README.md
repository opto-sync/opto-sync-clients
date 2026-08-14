# OptoSync client for PHP

The PHP 8.2+ package provides a transport-neutral protocol v1 mutation queue.
It is suitable for Laravel queue workers, Symfony Messenger, CLI processes, or
any application that supplies its own durable storage and HTTP transport.

```php
use ZedPkg\OptoSync\Client;

$client = new Client(
    baseUrl: 'https://sync.example.com',
    bearerToken: $token,
    clientId: $durableDeviceId,
);

$client->enqueueUpsert(
    table: 'documents',
    recordId: 'doc-1',
    payload: ['title' => 'offline edit'],
);

$request = $client->buildPushRequest();
$exactRetryBody = $client->encodePushRequest();
```

Persist `exportQueue()` in the same transaction as the optimistic application
write. Retain `$exactRetryBody` until the server response is passed, together
with `$request`, to `acknowledgePush()`. The acknowledgement validator refuses
foreign clients, non-canonical checkpoints, reordered or partial results,
invalid duplicate metadata, and watermarks beyond the immutable request.

`restoreQueue()` validates the durable client identity, mutation sequence,
statuses, checkpoint, and next mutation id before accepting a snapshot. Queue
and payload limits are enforced before a mutation is accepted.

The original two-argument constructor remains valid for integrations that only
used the package as endpoint configuration. A stable `clientId` is required
before protocol queue methods can be used; it should identify one durable
installation, not one PHP process.

Run the executable package contract with:

```sh
composer install
composer test
```

