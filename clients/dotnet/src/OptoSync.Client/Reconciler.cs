using System.Runtime.InteropServices;

namespace OptoSync;

/// <summary>Array semantics supported by the native reconciliation engine.</summary>
public enum ArrayMergeStrategy
{
    /// <summary>Replace the complete base array with the incoming array.</summary>
    Replace = 0,

    /// <summary>Append every incoming element after the base elements.</summary>
    Append = 1,

    /// <summary>Append only incoming elements not already present in the base.</summary>
    Union = 2,

    /// <summary>Deep-merge elements at matching array indexes.</summary>
    MergeByIndex = 3,

    /// <summary>Deep-merge object elements by a stable identity key.</summary>
    MergeByKey = 4,
}

/// <summary>Options passed unchanged to <c>syncer_merge_json_ex</c>.</summary>
public sealed record MergeOptions
{
    /// <summary>Whether configured timestamp selectors decide node conflicts.</summary>
    public bool ResolveByTimestamp { get; init; } = true;

    /// <summary>Comma-separated LWW keys or relative RFC 6901 selectors.</summary>
    public string? LastWriteWinsKeys { get; init; } = "updatedAt,syncedAt";

    /// <summary>Comma-separated FWW keys or relative RFC 6901 selectors.</summary>
    public string? FirstWriteWinsKeys { get; init; }

    /// <summary>How arrays are reconciled.</summary>
    public ArrayMergeStrategy ArrayStrategy { get; init; } = ArrayMergeStrategy.MergeByKey;

    /// <summary>Comma-separated identity keys used by MergeByKey.</summary>
    public string? ArrayMatchKeys { get; init; } = "id";

    /// <summary>Maximum recursive merge depth, or zero for unlimited.</summary>
    public uint MaxDepth { get; init; }

    /// <summary>Whether the core should detect circular references.</summary>
    public bool DetectCircularReferences { get; init; }

    /// <summary>The standard OptoSync CRDT-style policy.</summary>
    public static MergeOptions Default { get; } = new();

    /// <summary>
    /// Policy for replaying an unconfirmed local write over authoritative state.
    /// Timestamp gating is disabled so the optimistic write cannot disappear.
    /// </summary>
    public static MergeOptions OptimisticOverlay { get; } = new()
    {
        ResolveByTimestamp = false,
    };
}

/// <summary>Raised when the native core rejects a reconciliation request.</summary>
public sealed class OptoSyncMergeException : Exception
{
    /// <summary>Creates an exception for a rejected native merge.</summary>
    public OptoSyncMergeException(string message)
        : base(message)
    {
    }
}

/// <summary>
/// Memory-safe C# access to the pinned <c>syncer.c</c> reconciliation core.
/// </summary>
public static class Reconciler
{
    private const string NativeLibraryName = "syncer";

    static Reconciler()
    {
        NativeLibrary.SetDllImportResolver(typeof(Reconciler).Assembly, ResolveNativeLibrary);
    }

    /// <summary>Version reported by the loaded native core.</summary>
    public static string NativeVersion
    {
        get
        {
            var value = NativeMethods.SyncerVersion();
            return Marshal.PtrToStringUTF8(value)
                ?? throw new OptoSyncMergeException("The native OptoSync core returned an invalid version string.");
        }
    }

    /// <summary>Deep-merges incoming JSON over base JSON using OptoSync defaults.</summary>
    public static string MergeJson(string baseJson, string incomingJson) =>
        MergeJson(baseJson, incomingJson, MergeOptions.Default);

    /// <summary>Deep-merges incoming JSON over base JSON using an explicit policy.</summary>
    public static string MergeJson(
        string baseJson,
        string incomingJson,
        MergeOptions options)
    {
        ArgumentNullException.ThrowIfNull(baseJson);
        ArgumentNullException.ThrowIfNull(incomingJson);
        ArgumentNullException.ThrowIfNull(options);

        RejectInteriorNull(baseJson, nameof(baseJson));
        RejectInteriorNull(incomingJson, nameof(incomingJson));
        RejectInteriorNull(options.LastWriteWinsKeys, nameof(options.LastWriteWinsKeys));
        RejectInteriorNull(options.FirstWriteWinsKeys, nameof(options.FirstWriteWinsKeys));
        RejectInteriorNull(options.ArrayMatchKeys, nameof(options.ArrayMatchKeys));

        if (!Enum.IsDefined(options.ArrayStrategy))
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                options.ArrayStrategy,
                "ArrayStrategy must be a declared ArrayMergeStrategy value.");
        }

        var nativeOptions = new NativeMergeOptions
        {
            OverrideCallback = IntPtr.Zero,
            ArrayStrategy = (int)options.ArrayStrategy,
            MaxDepth = options.MaxDepth,
            DetectCircularReferences = options.DetectCircularReferences,
            ResolveByTimestamp = options.ResolveByTimestamp,
            LastWriteWinsKeys = options.LastWriteWinsKeys,
            FirstWriteWinsKeys = options.FirstWriteWinsKeys,
            ArrayMatchKeys = options.ArrayMatchKeys,
        };

        var result = NativeMethods.SyncerMergeJsonEx(baseJson, incomingJson, ref nativeOptions);
        if (result == IntPtr.Zero)
        {
            throw new OptoSyncMergeException(
                "The native OptoSync core rejected the merge. Verify the JSON and merge options.");
        }

        try
        {
            return Marshal.PtrToStringUTF8(result)
                ?? throw new OptoSyncMergeException("The native OptoSync core returned invalid UTF-8.");
        }
        finally
        {
            NativeMethods.SyncerFree(result);
        }
    }

    private static IntPtr ResolveNativeLibrary(
        string libraryName,
        System.Reflection.Assembly assembly,
        DllImportSearchPath? searchPath)
    {
        if (!string.Equals(libraryName, NativeLibraryName, StringComparison.Ordinal))
        {
            return IntPtr.Zero;
        }

        var explicitPath = Environment.GetEnvironmentVariable("OPTO_SYNC_NATIVE_LIBRARY");
        return string.IsNullOrWhiteSpace(explicitPath)
            ? IntPtr.Zero
            : NativeLibrary.Load(explicitPath, assembly, searchPath);
    }

    private static void RejectInteriorNull(string? value, string parameterName)
    {
        if (value?.Contains('\0') == true)
        {
            throw new ArgumentException("Values passed to the native core may not contain a NUL byte.", parameterName);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMergeOptions
    {
        public IntPtr OverrideCallback;
        public int ArrayStrategy;
        public uint MaxDepth;

        [MarshalAs(UnmanagedType.I1)]
        public bool DetectCircularReferences;

        [MarshalAs(UnmanagedType.I1)]
        public bool ResolveByTimestamp;

        [MarshalAs(UnmanagedType.LPUTF8Str)]
        public string? LastWriteWinsKeys;

        [MarshalAs(UnmanagedType.LPUTF8Str)]
        public string? FirstWriteWinsKeys;

        [MarshalAs(UnmanagedType.LPUTF8Str)]
        public string? ArrayMatchKeys;
    }

    private static class NativeMethods
    {
        [DllImport(
            NativeLibraryName,
            EntryPoint = "syncer_merge_json_ex",
            CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr SyncerMergeJsonEx(
            [MarshalAs(UnmanagedType.LPUTF8Str)] string baseJson,
            [MarshalAs(UnmanagedType.LPUTF8Str)] string incomingJson,
            ref NativeMergeOptions options);

        [DllImport(
            NativeLibraryName,
            EntryPoint = "syncer_free",
            CallingConvention = CallingConvention.Cdecl)]
        public static extern void SyncerFree(IntPtr value);

        [DllImport(
            NativeLibraryName,
            EntryPoint = "syncer_version",
            CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr SyncerVersion();
    }
}
