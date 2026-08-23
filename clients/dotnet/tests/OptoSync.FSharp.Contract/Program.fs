module OptoSyncFSharpContract

open System
open System.Text.Json
open OptoSync.FSharp

let require condition message =
    if not condition then
        invalidOp message

let titleFrom json =
    use document = JsonDocument.Parse(json: string)
    document.RootElement.GetProperty("title").GetString()

[<EntryPoint>]
let main _ =
    let fresh =
        Reconciliation.merge
            """{"id":"safe-1","title":"local","updatedAt":"2026-08-14T10:00:00Z"}"""
            """{"id":"safe-1","title":"server","updatedAt":"2026-08-14T11:00:00Z"}"""

    require (titleFrom fresh = "server") "The F# default policy must accept a newer server write."

    let optimistic =
        Reconciliation.mergeWith
            MergePolicy.optimisticOverlay
            """{"id":"safe-2","title":"server","updatedAt":"2026-08-14T11:00:00Z"}"""
            """{"id":"safe-2","title":"offline Fable edit","updatedAt":"2026-08-14T10:00:00Z"}"""

    require
        (titleFrom optimistic = "offline Fable edit")
        "The F# optimistic policy must preserve an unconfirmed Fable write."

    let replaceArrayPolicy =
        { MergePolicy.defaultPolicy with
            ArrayStrategy = ArrayMerge.Replace }

    let replaced =
        Reconciliation.mergeWith
            replaceArrayPolicy
            """{"id":"safe-list","items":[{"id":"a"}]}"""
            """{"id":"safe-list","items":[{"id":"b"}]}"""

    use replacedDocument = JsonDocument.Parse(replaced)
    let replacedItems = replacedDocument.RootElement.GetProperty("items")
    require (replacedItems.GetArrayLength() = 1) "An explicit F# array policy must reach the native core."
    require
        (replacedItems[0].GetProperty("id").GetString() = "b")
        "Replace policy must select the incoming array."

    let version = Reconciliation.nativeVersion ()
    require (version.Split('.').Length = 3) "F# must expose the native semantic version."
    printfn "F# native reconciliation contract passed with syncer.c %s." version
    0
