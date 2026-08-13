#include "opto_sync_client.h"
opto_sync_client opto_sync_client_new(const char *base_url, const char *bearer_token) {
  opto_sync_client value = {base_url, bearer_token}; return value;
}
bool opto_sync_client_health(const opto_sync_client *client) { return client != 0 && client->base_url != 0; }
