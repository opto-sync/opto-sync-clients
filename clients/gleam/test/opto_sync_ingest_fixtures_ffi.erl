%% Reads the shared cross-language fixture corpus from disk for the Gleam
%% validator tests. Kept as FFI because the client has no filesystem dependency
%% of its own and should not gain one just to run its tests.
-module(opto_sync_ingest_fixtures_ffi).
-export([list_fixtures/1]).

%% Returns [{Filename, Contents}] sorted by name, so a failure names the
%% fixture that caused it.
list_fixtures(Kind) ->
    Dir = filename:join(["../../schema/fixtures", binary_to_list(Kind)]),
    {ok, Names} = file:list_dir(Dir),
    Json = lists:sort([N || N <- Names, lists:suffix(".json", N)]),
    [
        begin
            {ok, Bin} = file:read_file(filename:join(Dir, N)),
            {list_to_binary(N), Bin}
        end
     || N <- Json
    ].
