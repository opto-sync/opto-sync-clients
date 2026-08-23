#ifndef OPTO_SYNC_CLIENT_H
#define OPTO_SYNC_CLIENT_H
#include <stdbool.h>
typedef struct { const char *base_url; const char *bearer_token; } opto_sync_client;
opto_sync_client opto_sync_client_new(const char *base_url, const char *bearer_token);
bool opto_sync_client_health(const opto_sync_client *client);
#endif
