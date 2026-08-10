%% Repository-local BEAM adapter for fmctl.adapter.v1.
%%
%% File/process I/O and trace traversal live here because they are operational
%% concerns. Every protocol transition, response validator, and canonical
%% observation is delegated to the production Gleam modules.
-module(opto_sync_formal_replay_ffi).
-export([main/0]).

-define(PROTOCOL, <<"fmctl.adapter.v1">>).

main() ->
    Response =
        try
            execute()
        catch
            throw:{replay_error, Path, Index, Action, Message} ->
                error_response(Path, Index, Action, Message);
            throw:{adapter_error, Message} ->
                error_response(null, null, null, Message);
            Class:Reason:Stack ->
                io:format(
                    standard_error,
                    "Gleam formal adapter internal error ~p:~p~n~p~n",
                    [Class, Reason, Stack]
                ),
                error_response(
                    null,
                    null,
                    null,
                    format_binary("internal adapter error: ~p:~p", [Class, Reason])
                )
        end,
    emit(Response),
    erlang:halt(0).

execute() ->
    Request = object(decode_json(read_stdin()), <<"adapter request">>),
    Protocol = required_binary(Request, <<"protocol">>),
    ensure(
        Protocol =:= ?PROTOCOL,
        format_binary("unsupported adapter protocol ~p", [Protocol])
    ),
    TracePaths = required_list(Request, <<"tracePaths">>),
    ensure(TracePaths =/= [], <<"tracePaths must not be empty">>),
    lists:foreach(
        fun(Path) ->
            ensure(is_binary(Path) andalso byte_size(Path) > 0, <<"tracePaths entries must be non-empty strings">>)
        end,
        TracePaths
    ),
    {TraceCount, StateCount} = replay_paths(TracePaths),
    #{
        <<"protocol">> => ?PROTOCOL,
        <<"result">> => #{
            <<"status">> => <<"ok">>,
            <<"traceCount">> => TraceCount,
            <<"stateCount">> => StateCount
        }
    }.

replay_paths(Paths) ->
    lists:foldl(
        fun(Path, {TraceCount, StateCount}) ->
            Count = replay_trace(Path),
            {TraceCount + 1, StateCount + Count}
        end,
        {0, 0},
        Paths
    ).

replay_trace(Path) ->
    Trace = object(decode_json(read_file(Path)), <<"ITF trace">>),
    States = required_list(Trace, <<"states">>),
    ensure(States =/= [], format_binary("~s contains no ITF states", [Path])),
    {_Adapter, Count} =
        lists:foldl(
            fun(StateValue, {Adapter, Index}) ->
                StateObject = object(StateValue, <<"ITF state">>),
                Action = action_name(StateObject),
                NewAdapter =
                    try
                        Applied = apply_action(Action, StateObject, Adapter),
                        assert_projection(Applied, StateObject),
                        Applied
                    catch
                        throw:{adapter_error, Message} ->
                            throw({replay_error, Path, Index, Action, Message})
                    end,
                {NewAdapter, Index + 1}
            end,
            {new_adapter(), 0},
            States
        ),
    Count.

new_adapter() ->
    #{
        state => opto_sync_formal_projection:initial_state(),
        initialized => false,
        request => none,
        response => none,
        replacing => false
    }.

apply_action(<<"init">>, _TraceState, Adapter) ->
    Adapter#{
        state := opto_sync_formal_projection:initial_state(),
        initialized := true,
        request := none,
        response := none,
        replacing := false
    };
apply_action(Action, TraceState, Adapter0) ->
    ensure(
        maps:get(initialized, Adapter0),
        format_binary("action ~s occurred before init", [Action])
    ),
    apply_initialized(Action, TraceState, Adapter0).

apply_initialized(<<"idle">>, _TraceState, Adapter) ->
    Adapter;
apply_initialized(<<"compact">>, _TraceState, Adapter) ->
    %% Compaction is a server-history transition. The client projection keeps
    %% only its pull checkpoint and reset phase, so this is a deliberate stutter.
    Adapter;
apply_initialized(<<"enqueue">>, TraceState, Adapter) ->
    Model = model_state(TraceState),
    ExpectedId = model_bigint(Model, <<"next_id">>) - 1,
    {NewState, ActualId} = opto_sync_formal_projection:enqueue(maps:get(state, Adapter)),
    ensure(
        ActualId =:= ExpectedId,
        format_binary("enqueue allocated ~p; model allocated ~p", [ActualId, ExpectedId])
    ),
    Adapter#{state := NewState};
apply_initialized(<<"send">>, TraceState, Adapter) ->
    ensure(maps:get(request, Adapter) =:= none, <<"request already in flight">>),
    ensure(maps:get(response, Adapter) =:= none, <<"response already present">>),
    Id = picked_id(TraceState),
    Pending = model_set(model_state(TraceState), <<"pending">>),
    ensure(lists:member(Id, Pending), <<"send selected a non-pending mutation">>),
    Adapter#{request := Id};
apply_initialized(<<"apply_new">>, TraceState, Adapter) ->
    server_reply(TraceState, Adapter, true, <<"applied">>);
apply_initialized(<<"reject_new">>, TraceState, Adapter) ->
    server_reply(TraceState, Adapter, false, <<"rejected">>);
apply_initialized(<<"reply_duplicate">>, TraceState, Adapter) ->
    Model = model_state(TraceState),
    Id = picked_id(TraceState),
    Applied = lists:member(Id, model_set(Model, <<"applied">>)),
    OriginalStatus = case Applied of true -> <<"applied">>; false -> <<"rejected">> end,
    server_reply(TraceState, Adapter, Applied, <<"duplicate">>, OriginalStatus);
apply_initialized(<<"inject_mismatched_response">>, TraceState, Adapter) ->
    RequestId = require_request(Adapter),
    ensure(maps:get(response, Adapter) =:= none, <<"response already present">>),
    Model = model_state(TraceState),
    ResponseId = model_bigint(Model, <<"response_mutation_id">>),
    Watermark = model_bigint(Model, <<"response_watermark">>),
    Checkpoint = model_bigint(Model, <<"response_checkpoint">>),
    Rejected = opto_sync_formal_adapter:mismatched_response_rejected(
        RequestId,
        ResponseId,
        Watermark,
        Checkpoint
    ),
    ensure(Rejected =:= true, <<"production Gleam validator accepted mismatched response">>),
    Adapter#{
        response := #{
            mutation_id => ResponseId,
            watermark => Watermark,
            checkpoint => Checkpoint,
            valid => false,
            status => <<"applied">>
        }
    };
apply_initialized(<<"lose_committed_response">>, _TraceState, Adapter) ->
    Adapter#{request := none, response := none};
apply_initialized(<<"lose_uncommitted_request">>, _TraceState, Adapter) ->
    Adapter#{request := none, response := none};
apply_initialized(<<"discard_malformed_response">>, _TraceState, Adapter) ->
    Response = require_response(Adapter),
    ensure(maps:get(valid, Response) =:= false, <<"discard requires rejected response">>),
    Adapter#{request := none, response := none};
apply_initialized(<<"acknowledge">>, TraceState, Adapter) ->
    Id = picked_id(TraceState),
    RequestId = require_request(Adapter),
    Response = require_response(Adapter),
    ensure(RequestId =:= Id, <<"acknowledgement id differs from request">>),
    ensure(maps:get(mutation_id, Response) =:= Id, <<"acknowledgement id differs from response">>),
    ensure(maps:get(valid, Response) =:= true, <<"cannot acknowledge invalid response">>),
    NewState = opto_sync_formal_projection:acknowledge(maps:get(state, Adapter), Id, true),
    Adapter#{state := NewState, request := none, response := none};
apply_initialized(<<"pull">>, TraceState, Adapter) ->
    Checkpoint = model_bigint(model_state(TraceState), <<"local_checkpoint">>),
    NewState = opto_sync_formal_projection:pull(maps:get(state, Adapter), Checkpoint),
    Adapter#{state := NewState};
apply_initialized(<<"begin_reset">>, _TraceState, Adapter) ->
    ensure(maps:get(replacing, Adapter) =:= false, <<"snapshot replacement already active">>),
    NewState = opto_sync_formal_projection:begin_reset(maps:get(state, Adapter)),
    Adapter#{state := NewState, replacing := true};
apply_initialized(<<"crash_during_reset">>, _TraceState, Adapter) ->
    ensure(maps:get(replacing, Adapter) =:= true, <<"reset crash without active replacement">>),
    NewState = opto_sync_formal_projection:crash_during_reset(maps:get(state, Adapter)),
    Adapter#{state := NewState, replacing := false};
apply_initialized(<<"finish_reset">>, TraceState, Adapter) ->
    ensure(maps:get(replacing, Adapter) =:= true, <<"finish reset without active replacement">>),
    Checkpoint = model_bigint(model_state(TraceState), <<"server_checkpoint">>),
    NewState = opto_sync_formal_projection:finish_reset(maps:get(state, Adapter), Checkpoint),
    Adapter#{state := NewState, replacing := false};
apply_initialized(Action, _TraceState, _Adapter) ->
    fail(format_binary("unsupported model action ~s", [Action])).

server_reply(TraceState, Adapter, Applied, Status) ->
    server_reply(TraceState, Adapter, Applied, Status, none).

server_reply(TraceState, Adapter, Applied, Status, OriginalStatus) ->
    Id = picked_id(TraceState),
    RequestId = require_request(Adapter),
    ensure(RequestId =:= Id, <<"server reply id differs from in-flight request">>),
    ensure(maps:get(response, Adapter) =:= none, <<"response already present">>),
    {NewState, Reply} = opto_sync_formal_projection:server_outcome(
        maps:get(state, Adapter),
        Id,
        Applied
    ),
    Model = model_state(TraceState),
    ReplyMap = object(
        decode_json(opto_sync_formal_adapter:reply_json(Reply)),
        <<"production reply">>
    ),
    assert_reply(ReplyMap, Model, Status, OriginalStatus),
    Adapter#{
        state := NewState,
        response := #{
            mutation_id => model_bigint(Model, <<"response_mutation_id">>),
            watermark => model_bigint(Model, <<"response_watermark">>),
            checkpoint => model_bigint(Model, <<"response_checkpoint">>),
            valid => true,
            status => Status
        }
    }.

assert_reply(Reply, Model, Status, OriginalStatus) ->
    ensure(required_binary(Reply, <<"status">>) =:= Status, <<"production reply status differs from model">>),
    ensure(
        json_bigint(required(Reply, <<"mutationId">>)) =:= model_bigint(Model, <<"response_mutation_id">>),
        <<"production reply mutation id differs from model">>
    ),
    ensure(
        json_bigint(required(Reply, <<"watermark">>)) =:= model_bigint(Model, <<"response_watermark">>),
        <<"production reply watermark differs from model">>
    ),
    ensure(
        json_bigint(required(Reply, <<"checkpoint">>)) =:= model_bigint(Model, <<"response_checkpoint">>),
        <<"production reply checkpoint differs from model">>
    ),
    case OriginalStatus of
        none -> ok;
        Expected ->
            ensure(
                required_binary(Reply, <<"originalStatus">>) =:= Expected,
                <<"duplicate original status differs from model">>
            )
    end.

assert_projection(Adapter, TraceState) ->
    Model = model_state(TraceState),
    Actual = object(
        decode_json(opto_sync_formal_adapter:projection_json(maps:get(state, Adapter))),
        <<"Gleam projection">>
    ),
    ExpectedNext = model_bigint(Model, <<"next_id">>),
    ensure(
        json_bigint(required(Actual, <<"nextId">>)) =:= ExpectedNext,
        <<"next mutation id differs from model">>
    ),
    ensure_equal_set(
        json_set(required(Actual, <<"pending">>)),
        model_set(Model, <<"pending">>),
        <<"pending mutation ids">>
    ),
    ensure_equal_set(
        json_set(required(Actual, <<"confirmed">>)),
        model_set(Model, <<"acknowledged">>),
        <<"confirmed mutation ids">>
    ),
    ensure(
        json_bigint(required(Actual, <<"checkpoint">>)) =:= model_bigint(Model, <<"local_checkpoint">>),
        <<"pull checkpoint differs from model">>
    ),
    ExpectedPhase = model_reset_phase(Model),
    ensure(
        required_binary(Actual, <<"resetPhase">>) =:= ExpectedPhase,
        <<"production reset phase differs from model">>
    ),
    ensure(
        maps:get(replacing, Adapter) =:= (ExpectedPhase =:= <<"replacing">>),
        <<"adapter reset control differs from model">>
    ),
    ensure_equal_outcomes(
        actual_outcomes(required_list(Actual, <<"knownOutcomes">>)),
        expected_outcomes(Model)
    ),
    ensure_allocated_ids_contiguous(required(Actual, <<"allocated">>), ExpectedNext),
    assert_request(Adapter, Model),
    assert_response(Adapter, Model),
    ok.

assert_request(Adapter, Model) ->
    Expected = model_bigint(Model, <<"in_flight">>),
    case maps:get(request, Adapter) of
        none -> ensure(Expected =:= 0, <<"model has in-flight request; adapter has none">>);
        Actual -> ensure(Actual =:= Expected, <<"in-flight request differs from model">>)
    end.

assert_response(Adapter, Model) ->
    Present = model_bool(Model, <<"response_present">>),
    case {Present, maps:get(response, Adapter)} of
        {false, none} -> ok;
        {false, _} -> fail(<<"adapter has response; model has none">>);
        {true, none} -> fail(<<"model has response; adapter has none">>);
        {true, Response} ->
            ensure(
                maps:get(mutation_id, Response) =:= model_bigint(Model, <<"response_mutation_id">>),
                <<"response mutation id differs from model">>
            ),
            ensure(
                maps:get(watermark, Response) =:= model_bigint(Model, <<"response_watermark">>),
                <<"response watermark differs from model">>
            ),
            ensure(
                maps:get(checkpoint, Response) =:= model_bigint(Model, <<"response_checkpoint">>),
                <<"response checkpoint differs from model">>
            ),
            ensure(
                maps:get(valid, Response) =:= model_bool(Model, <<"response_valid_for_in_flight">>),
                <<"response validity differs from model">>
            )
    end.

ensure_allocated_ids_contiguous(ActualValue, NextId) ->
    Expected = case NextId of
        1 -> [];
        _ when NextId > 1 -> lists:seq(1, NextId - 1)
    end,
    ensure_equal_set(json_set(ActualValue), Expected, <<"allocated mutation ids">>).

actual_outcomes(Entries) ->
    lists:sort([
        {
            json_bigint(required(object(Entry, <<"known outcome">>), <<"id">>)),
            required_binary(object(Entry, <<"known outcome">>), <<"status">>)
        }
     || Entry <- Entries
    ]).

expected_outcomes(Model) ->
    lists:sort(
        [{Id, <<"applied">>} || Id <- model_set(Model, <<"applied">>)] ++
        [{Id, <<"rejected">>} || Id <- model_set(Model, <<"rejected">>)]
    ).

ensure_equal_outcomes(Actual, Expected) ->
    ensure(
        Actual =:= Expected,
        format_binary("known outcomes ~p differ from model ~p", [Actual, Expected])
    ).

ensure_equal_set(Actual, Expected, Label) ->
    Left = lists:usort(Actual),
    Right = lists:usort(Expected),
    ensure(
        Left =:= Right,
        format_binary("~s ~p differ from model ~p", [Label, Left, Right])
    ).

require_request(Adapter) ->
    case maps:get(request, Adapter) of
        none -> fail(<<"no in-flight request">>);
        Id -> Id
    end.

require_response(Adapter) ->
    case maps:get(response, Adapter) of
        none -> fail(<<"no response present">>);
        Response -> Response
    end.

model_state(TraceState) ->
    object(required(TraceState, <<"s">>), <<"model state">>).

model_bigint(Model, Key) ->
    json_bigint(required(Model, Key)).

model_bool(Model, Key) ->
    Value = required(Model, Key),
    ensure(is_boolean(Value), format_binary("model field ~s must be boolean", [Key])),
    Value.

model_set(Model, Key) ->
    json_set(required(Model, Key)).

model_reset_phase(Model) ->
    Tagged = object(required(Model, <<"reset_phase">>), <<"reset phase">>),
    case required_binary(Tagged, <<"tag">>) of
        <<"Idle">> -> <<"ready">>;
        <<"Ready">> -> <<"ready">>;
        <<"Replacing">> -> <<"replacing">>;
        Other -> fail(format_binary("unknown reset phase ~p", [Other]))
    end.

action_name(State) ->
    case maps:find(<<"action">>, State) of
        {ok, Action} when is_binary(Action) -> Action;
        _ ->
            case maps:find(<<"mbt::actionTaken">>, State) of
                {ok, Action} when is_binary(Action) -> Action;
                _ -> fail(<<"ITF state lacks action metadata">>)
            end
    end.

picked_id(State) ->
    Picks = case maps:find(<<"nondetPicks">>, State) of
        {ok, Value} -> object(Value, <<"nondeterministic picks">>);
        error -> object(required(State, <<"mbt::nondetPicks">>), <<"nondeterministic picks">>)
    end,
    Choice = object(required(Picks, <<"id">>), <<"picked id">>),
    ensure(required_binary(Choice, <<"tag">>) =:= <<"Some">>, <<"action requires picked id">>),
    json_bigint(required(Choice, <<"value">>)).

json_bigint(Value) when is_integer(Value) ->
    Value;
json_bigint(Value) ->
    Object = object(Value, <<"tagged bigint">>),
    Encoded = required_binary(Object, <<"#bigint">>),
    try binary_to_integer(Encoded) of
        Integer -> Integer
    catch
        error:badarg -> fail(format_binary("invalid tagged bigint ~p", [Encoded]))
    end.

json_set(Value) ->
    SetObject = object(Value, <<"ITF set">>),
    lists:sort([json_bigint(Item) || Item <- required_list(SetObject, <<"#set">>)]).

required(Map, Key) ->
    case maps:find(Key, Map) of
        {ok, Value} -> Value;
        error -> fail(format_binary("missing JSON field ~s", [Key]))
    end.

required_binary(Map, Key) ->
    Value = required(Map, Key),
    ensure(is_binary(Value), format_binary("JSON field ~s must be a string", [Key])),
    Value.

required_list(Map, Key) ->
    Value = required(Map, Key),
    ensure(is_list(Value), format_binary("JSON field ~s must be an array", [Key])),
    Value.

object(Value, _Label) when is_map(Value) ->
    Value;
object(Value, Label) when is_list(Value) ->
    case is_object_list(Value) of
        true -> maps:from_list(Value);
        false -> fail(format_binary("~s must be an object", [Label]))
    end;
object(_Value, Label) ->
    fail(format_binary("~s must be an object", [Label])).

is_object_list([]) -> true;
is_object_list([{Key, _Value} | Rest]) when is_binary(Key) -> is_object_list(Rest);
is_object_list(_) -> false.

read_stdin() ->
    read_stdin([]).

read_stdin(Acc) ->
    case io:get_chars(standard_io, "", 8192) of
        eof -> iolist_to_binary(lists:reverse(Acc));
        {error, Reason} -> fail(format_binary("reading adapter request: ~p", [Reason]));
        Data -> read_stdin([Data | Acc])
    end.

read_file(Path) ->
    case file:read_file(binary_to_list(Path)) of
        {ok, Content} -> Content;
        {error, Reason} -> fail(format_binary("reading trace ~s: ~p", [Path, Reason]))
    end.

decode_json(Content) ->
    Decoded = case thoas:decode(Content) of
        {ok, Value} -> Value;
        {ok, Value, _Rest} -> Value;
        {error, Reason} -> fail(format_binary("invalid JSON: ~p", [Reason]));
        Value -> Value
    end,
    normalize_json(Decoded).

normalize_json(Value) when is_map(Value) ->
    maps:from_list([{Key, normalize_json(Item)} || {Key, Item} <- maps:to_list(Value)]);
normalize_json(Value) when is_list(Value) ->
    %% OTP 27's json decoder already represents objects as maps and arrays as
    %% lists. Treat every decoded list as an array so [] remains [] instead of
    %% being mistaken for an empty proplist/object.
    [normalize_json(Item) || Item <- Value];
normalize_json(Value) ->
    Value.

encode_json(Value) ->
    case thoas:encode(Value) of
        {ok, Encoded} -> Encoded;
        Encoded -> Encoded
    end.

emit(Value) ->
    io:put_chars(standard_io, [encode_json(Value), <<"\n">>]).

error_response(Path, Index, Action, Message) ->
    #{
        <<"protocol">> => ?PROTOCOL,
        <<"result">> => #{
            <<"status">> => <<"error">>,
            <<"tracePath">> => Path,
            <<"stateIndex">> => Index,
            <<"action">> => Action,
            <<"error">> => Message
        }
    }.

ensure(true, _Message) -> ok;
ensure(false, Message) -> fail(Message).

fail(Message) when is_binary(Message) ->
    throw({adapter_error, Message}).

format_binary(Format, Args) ->
    iolist_to_binary(io_lib:format(Format, Args)).
