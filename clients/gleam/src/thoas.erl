%% Repository-local compatibility boundary for the former Thoas JSON API.
%%
%% The formal replay harness historically called thoas:decode/1 and
%% thoas:encode/1 directly, while gleam_json 3 no longer brings the external
%% Thoas application into the runtime dependency graph. The Gleam adapter pins
%% Erlang/OTP 27, whose stdlib json module provides the same binary/map/list
%% representation needed by the harness. Keeping this two-function shim makes
%% the operational Erlang code independent of an undeclared transitive package
%% without duplicating JSON parsing or changing protocol semantics.
-module(thoas).
-export([decode/1, encode/1]).

-spec decode(binary()) -> {ok, term()} | {error, term()}.
decode(Content) when is_binary(Content) ->
    try
        {ok, json:decode(Content)}
    catch
        error:Reason -> {error, Reason}
    end.

-spec encode(term()) -> {ok, binary()} | {error, term()}.
encode(Value) ->
    try
        {ok, iolist_to_binary(json:encode(Value))}
    catch
        error:Reason -> {error, Reason}
    end.
