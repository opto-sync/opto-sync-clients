import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OptoSync.Config;

@id("OptoSyncMode")
enum OptoSyncMode {
  client: "client",
  server: "server",
  hybrid: "hybrid",
}

@id("EnvKind")
enum EnvKind {
  string: "string",
  bool: "bool",
  integer: "integer",
  double: "double",
  json: "json",
  url: "url",
}

@id("Flags2EnvPrecedence")
enum Flags2EnvPrecedence {
  argv_over_env: "argv-over-env",
}

@id("ConflictPolicy")
enum ConflictPolicy {
  server_wins: "server-wins",
  client_wins: "client-wins",
  last_write_wins: "last-write-wins",
  manual: "manual",
}

@id("Flags2EnvConfig")
model Flags2EnvConfig {
  @minLength(1)
  @maxLength(256)
  contract: string;
  require_audit: boolean;
  precedence: Flags2EnvPrecedence;
}

@id("EnvBinding")
model EnvBinding {
  @minLength(1)
  @maxLength(64)
  @pattern("^[a-z][a-z0-9_]*$")
  name: string;

  @minLength(1)
  @maxLength(128)
  @pattern("^[A-Z_][A-Z0-9_]*$")
  key: string;

  kind: EnvKind;
  required: boolean;
  secret: boolean;

  @maxLength(8192)
  default?: string;

  @maxLength(512)
  description?: string;
}

@id("SyncPolicy")
model SyncPolicy {
  @minValue(100)
  @maxValue(3600000)
  push_interval_ms: int32;

  @minValue(100)
  @maxValue(3600000)
  pull_interval_ms: int32;

  @minValue(1)
  @maxValue(10000)
  max_batch_size: int32;

  conflict_policy: ConflictPolicy;
}

@id("OptoSyncClientConfig")
model OptoSyncClientConfig {
  enabled: boolean;

  @minLength(1)
  @maxLength(64)
  api_base_url_binding?: string;

  @minLength(1)
  @maxLength(64)
  device_id_binding?: string;

  @minLength(1)
  @maxLength(64)
  auth_token_binding?: string;

  @minLength(1)
  @maxLength(64)
  local_store_binding?: string;

  @minLength(1)
  @maxLength(64)
  background_sync_binding?: string;
}

@id("OptoSyncServerConfig")
model OptoSyncServerConfig {
  enabled: boolean;

  @minLength(1)
  @maxLength(64)
  bind_addr_binding?: string;

  @minLength(1)
  @maxLength(64)
  database_url_binding?: string;

  @minLength(1)
  @maxLength(64)
  nats_url_binding?: string;

  @minLength(1)
  @maxLength(64)
  redis_url_binding?: string;

  @minLength(1)
  @maxLength(64)
  poll_interval_ms_binding?: string;

  @minLength(1)
  @maxLength(64)
  pubsub_channel_binding?: string;
}

@id("OptoSyncConfig")
model OptoSyncConfig {
  @minValue(1)
  @maxValue(1)
  version: int32;

  mode: OptoSyncMode;
  strict: boolean;
  flags2env: Flags2EnvConfig;
  sync: SyncPolicy;
  env: EnvBinding[];
  client?: OptoSyncClientConfig;
  server?: OptoSyncServerConfig;
}
