import { Client } from './mod.ts';

Deno.test('constructs a client from an absolute base URL', () => {
  const client = new Client({ baseUrl: 'https://sync.example.test/v1' });
  if (client.baseUrl.href !== 'https://sync.example.test/v1') {
    throw new Error(`unexpected normalized URL: ${client.baseUrl.href}`);
  }
  if (client.bearerToken !== undefined) {
    throw new Error('the bearer token must remain opt-in');
  }
});

Deno.test('preserves an explicitly injected bearer token', () => {
  const client = new Client({
    baseUrl: 'https://sync.example.test',
    bearerToken: 'test-token',
  });
  if (client.bearerToken !== 'test-token') {
    throw new Error('the injected token was not retained');
  }
});

Deno.test('rejects a relative base URL', () => {
  let rejected = false;
  try {
    new Client({ baseUrl: '/relative' });
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) throw new Error('relative base URLs must be rejected');
});
