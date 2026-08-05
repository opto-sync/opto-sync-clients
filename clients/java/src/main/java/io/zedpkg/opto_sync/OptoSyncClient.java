package io.zedpkg.opto_sync;
import java.net.URI;
public record OptoSyncClient(URI baseUri, String bearerToken) {}
