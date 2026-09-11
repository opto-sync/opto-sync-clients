# Durable form connectors

`@opto-sync/client/forms` queues a sanitized form envelope before network
transport. It supports ordinary JavaScript submission and HTMX progressive
enhancement without giving the browser database credentials.

## Persistence boundary

The browser queue is a durability and retry boundary, not the system of record.
The Rust API must validate the request, enforce its idempotency key, and persist
the canonical submission to the application's primary PostgreSQL database and
its configured Supabase mirror. Turnstile, CSRF, access, refresh, password, and
other token-like values are recursively removed before IndexedDB persistence.
File bytes are never queued; file metadata is opt-in.

Residency, identity, medical/accommodation, or other sensitive form payloads
should be removed from browser storage after the API returns its canonical
receipt. `BrowserFormQueue.deleteMutation(id)` provides that explicit retention
boundary. Keep only retryable/ambiguous submissions pending; delete successful
and terminally rejected copies.

## Compatibility and release parity

The typed and standalone connectors intentionally share the same sanitization
semantics. Both use the baseline `FormData.forEach()` API rather than requiring
`FormData.entries()`/`DOM.Iterable`, so projects with conservative DOM library
targets compile without weakening their TypeScript configuration. CI fingerprints
the complete `clients/ts` implementation tree and builds the checked-in
standalone modules alongside the CommonJS and ESM outputs.

The root `.zpkg.toml` and `clients/ts/package.json` form one coordinated release
identity. Isolated TypeScript target metadata and one-core checks derive that
version instead of carrying a second hardcoded release number.

## Static page / no framework

```js
import {
  createBrowserFormQueue,
  queueFormPayload,
} from '@opto-sync/client/forms/standalone';

const queue = createBrowserFormQueue({ databaseName: 'hhaus-intake' });
const queued = await queueFormPayload(queue, {
  formName: 'hhaus.pre-interest',
  tableName: 'form_submissions/hhaus/pre-interest',
  submissionId,
  sourceUrl: location.href,
  method: 'POST',
  payload,
});

const response = await fetch('/v1/pre-interests', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': submissionId,
  },
  body: JSON.stringify(payload),
});

if (response.ok) {
  await queue.deleteMutation(queued.queueId);
}
```

A normal `OptoSyncClient` can be passed instead of `BrowserFormQueue`; the
connector accepts the shared structural queue contract.

## Native form submission

```js
import { bindNativeForm } from '@opto-sync/client/forms';

const unbind = bindNativeForm(optoClient, form, {
  formName: 'member-profile',
  tableName: 'form_submissions/member-profile',
  submit: ({ envelope }) =>
    fetch(form.action, {
      method: form.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope.fields),
    }),
});
```

The returned function removes the listener. By default the connector fails
closed when the durable queue is unavailable. `failOpen: true` must be an
explicit product decision.

## HTMX

```js
import { bindHtmxForm } from '@opto-sync/client/forms';

const unbind = bindHtmxForm(optoClient, form, {
  formName: 'residency-application',
  tableName: 'form_submissions/residency-application',
});
```

The first submit is captured, durably queued, and replayed through
`requestSubmit()` so HTMX sees the original form. The connector adds stable
`_opto_submission_id` and `_opto_mutation_id` hidden fields, acknowledges 2xx
`htmx:afterRequest` events, rejects terminal 4xx responses, and leaves retryable
or ambiguous failures pending.
