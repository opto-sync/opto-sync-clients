package io.zedpkg.opto_sync
import java.net.URI
data class OptoSyncClient(val baseUri: URI, val bearerToken: String? = null)
