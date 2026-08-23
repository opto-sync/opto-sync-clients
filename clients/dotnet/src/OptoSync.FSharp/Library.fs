namespace OptoSync.FSharp

open System
open OptoSync

/// Array semantics exposed as an idiomatic discriminated union.
type ArrayMerge =
    | Replace
    | Append
    | Union
    | MergeByIndex
    | MergeByKey

/// Immutable F# reconciliation policy.
type MergePolicy =
    { ResolveByTimestamp: bool
      LastWriteWinsKeys: string list
      FirstWriteWinsKeys: string list
      ArrayStrategy: ArrayMerge
      ArrayMatchKeys: string list
      MaxDepth: uint32
      DetectCircularReferences: bool }

/// Standard policies shared by SAFE Stack and Fable consumers.
[<RequireQualifiedAccess>]
module MergePolicy =
    /// The standard OptoSync CRDT-style policy.
    let defaultPolicy =
        { ResolveByTimestamp = true
          LastWriteWinsKeys = [ "updatedAt"; "syncedAt" ]
          FirstWriteWinsKeys = []
          ArrayStrategy = MergeByKey
          ArrayMatchKeys = [ "id" ]
          MaxDepth = 0u
          DetectCircularReferences = false }

    /// Replay policy that keeps unconfirmed local writes visible over a pull.
    let optimisticOverlay =
        { defaultPolicy with
            ResolveByTimestamp = false }

/// Native-backed JSON reconciliation for F# callers.
[<RequireQualifiedAccess>]
module Reconciliation =
    let private selectorString values =
        match values with
        | [] -> null
        | selectors -> String.Join(",", selectors)

    let private managedStrategy strategy =
        match strategy with
        | Replace -> ArrayMergeStrategy.Replace
        | Append -> ArrayMergeStrategy.Append
        | Union -> ArrayMergeStrategy.Union
        | MergeByIndex -> ArrayMergeStrategy.MergeByIndex
        | MergeByKey -> ArrayMergeStrategy.MergeByKey

    let private managedOptions policy =
        MergeOptions(
            ResolveByTimestamp = policy.ResolveByTimestamp,
            LastWriteWinsKeys = selectorString policy.LastWriteWinsKeys,
            FirstWriteWinsKeys = selectorString policy.FirstWriteWinsKeys,
            ArrayStrategy = managedStrategy policy.ArrayStrategy,
            ArrayMatchKeys = selectorString policy.ArrayMatchKeys,
            MaxDepth = policy.MaxDepth,
            DetectCircularReferences = policy.DetectCircularReferences
        )

    /// Deep-merges incoming JSON over base JSON with the standard policy.
    let merge (baseJson: string) (incomingJson: string) =
        Reconciler.MergeJson(baseJson, incomingJson)

    /// Deep-merges incoming JSON over base JSON with an explicit F# policy.
    let mergeWith (policy: MergePolicy) (baseJson: string) (incomingJson: string) =
        Reconciler.MergeJson(baseJson, incomingJson, managedOptions policy)

    /// Version reported by the loaded pinned native core.
    let nativeVersion () = Reconciler.NativeVersion
