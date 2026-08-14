using System.Text.Json;
using OptoSync;

static JsonElement Merge(string baseJson, string incomingJson, MergeOptions? options = null)
{
    var merged = options is null
        ? Reconciler.MergeJson(baseJson, incomingJson)
        : Reconciler.MergeJson(baseJson, incomingJson, options);
    return JsonDocument.Parse(merged).RootElement.Clone();
}

static void Require(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

var versionParts = Reconciler.NativeVersion.Split('.');
Require(versionParts.Length == 3, "The native core must expose a semantic version.");

var newer = Merge(
    """{"id":"doc-1","title":"local","updatedAt":"2026-08-14T10:00:00Z"}""",
    """{"id":"doc-1","title":"server","updatedAt":"2026-08-14T11:00:00Z"}"""
);
Require(newer.GetProperty("title").GetString() == "server", "A newer incoming write must win.");

var stale = Merge(
    """{"id":"doc-1","title":"local","updatedAt":"2026-08-14T11:00:00Z"}""",
    """{"id":"doc-1","title":"stale","updatedAt":"2026-08-14T10:00:00Z"}"""
);
Require(stale.GetProperty("title").GetString() == "local", "A stale incoming write must not win.");

var keyed = Merge(
    """{"id":"list-1","items":[{"id":"a","done":false},{"id":"b","done":false}]}""",
    """{"id":"list-1","items":[{"id":"a","done":true},{"id":"c","done":false}]}"""
);
var items = keyed.GetProperty("items").EnumerateArray().ToDictionary(
    item => item.GetProperty("id").GetString()!,
    item => item
);
Require(items.Count == 3, "MergeByKey must retain and append distinct array members.");
Require(items["a"].GetProperty("done").GetBoolean(), "MergeByKey must reconcile a matching member.");

var overlay = Merge(
    """{"id":"doc-2","title":"server","updatedAt":"2026-08-14T11:00:00Z"}""",
    """{"id":"doc-2","title":"unconfirmed local","updatedAt":"2026-08-14T10:00:00Z"}""",
    MergeOptions.OptimisticOverlay
);
Require(
    overlay.GetProperty("title").GetString() == "unconfirmed local",
    "Optimistic overlay must keep an unconfirmed local write visible."
);

try
{
    Reconciler.MergeJson("not-json", "{}");
    throw new InvalidOperationException("Invalid JSON must be rejected.");
}
catch (OptoSyncMergeException)
{
}

try
{
    Reconciler.MergeJson("{}\0", "{}");
    throw new InvalidOperationException("Interior NUL bytes must be rejected before FFI.");
}
catch (ArgumentException)
{
}

Console.WriteLine($"C# native reconciliation contract passed with syncer.c {Reconciler.NativeVersion}.");
