%% Test-only filesystem access for the SHARED cross-language fixture corpus.
%%
%% The corpus lives at <repo>/schema/fixtures and is read in place rather than
%% copied, so a fixture added for any one language immediately binds all four
%% validators. Gleam's stdlib has no filesystem module, and adding a package
%% dependency for four calls would put it in the graph of every consumer of
%% this package, so these go straight to OTP.
-module(opto_sync_schema_test_ffi).

-export([cwd/0, parent/1, is_directory/1, list_directory/1, read_file/1]).

-spec cwd() -> binary().
cwd() ->
    {ok, Directory} = file:get_cwd(),
    unicode:characters_to_binary(Directory).

-spec parent(binary()) -> binary().
parent(Path) ->
    filename:dirname(Path).

-spec is_directory(binary()) -> boolean().
is_directory(Path) ->
    filelib:is_dir(Path).

-spec list_directory(binary()) -> {ok, [binary()]} | {error, nil}.
list_directory(Path) ->
    case file:list_dir(Path) of
        {ok, Names} ->
            {ok, lists:sort([unicode:characters_to_binary(Name) || Name <- Names])};
        {error, _} ->
            {error, nil}
    end.

-spec read_file(binary()) -> {ok, binary()} | {error, nil}.
read_file(Path) ->
    case file:read_file(Path) of
        {ok, Contents} -> {ok, Contents};
        {error, _} -> {error, nil}
    end.
