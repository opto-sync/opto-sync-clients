# OptoSync for C# and F#

This target gives .NET and SAFE Stack applications memory-safe access to the
same pinned `syncer.c` reconciliation engine used by the primary OptoSync
clients. It contains:

- `OptoSync.Client`, the C# P/Invoke binding and standard merge policy;
- `OptoSync.FSharp`, an idiomatic F# policy record and discriminated union;
- dependency-free C# and F# executable contract suites.

The binding never owns or substitutes a different merge implementation. The
native core allocates the result and the managed wrapper always releases it
through `syncer_free`, including when UTF-8 conversion fails.

## Build the pinned native core

On Linux:

```sh
cc -shared -fPIC -O2 \
  -I syncer.c/core/include \
  syncer.c/core/src/syncer.c syncer.c/core/src/yyjson.c \
  -o /tmp/libsyncer.so
export OPTO_SYNC_NATIVE_LIBRARY=/tmp/libsyncer.so
```

On macOS, use `-dynamiclib` and a `.dylib` output. On Windows, build the
`syncer` shared-library target with CMake and point
`OPTO_SYNC_NATIVE_LIBRARY` at the resulting DLL. Without that variable, .NET
uses its normal platform lookup for the library name `syncer`.

## C#

```csharp
using OptoSync;

var merged = Reconciler.MergeJson(
    """{"id":"todo-1","title":"offline","updatedAt":"2026-08-14T10:00:00Z"}""",
    """{"id":"todo-1","title":"server","updatedAt":"2026-08-14T11:00:00Z"}"""
);

var visible = Reconciler.MergeJson(
    authoritativeJson,
    unconfirmedLocalJson,
    MergeOptions.OptimisticOverlay
);
```

## F# and SAFE Stack

```fsharp
open OptoSync.FSharp

let merged =
    Reconciliation.merge localJson serverJson

let optimisticView =
    Reconciliation.mergeWith
        MergePolicy.optimisticOverlay
        authoritativeJson
        unconfirmedFableJson
```

`MergePolicy.defaultPolicy` enables timestamp resolution with
`updatedAt,syncedAt` as Last-Write-Wins selectors, leaves First-Write-Wins
disabled, and merges array objects by `id`. The array strategy, selectors,
depth boundary, and circular-reference detection remain explicit and
overridable from both languages.

## Contract suites

```sh
dotnet run --project clients/dotnet/tests/OptoSync.Client.Contract --configuration Release
dotnet run --project clients/dotnet/tests/OptoSync.FSharp.Contract --configuration Release
```

Both suites load the native library selected by `OPTO_SYNC_NATIVE_LIBRARY` and
verify timestamp conflict resolution, optimistic replay, array policy, invalid
input handling, and native version discovery.
