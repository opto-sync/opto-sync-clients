defmodule OptoSyncClientTest do
  use ExUnit.Case, async: true

  test "new/1 applies the nil bearer-token default" do
    assert %OptoSyncClient{
             base_url: "https://sync.example.test",
             bearer_token: nil
           } = OptoSyncClient.new("https://sync.example.test")
  end

  test "new/2 preserves an explicitly injected bearer token" do
    assert %OptoSyncClient{bearer_token: "test-token"} =
             OptoSyncClient.new("https://sync.example.test", "test-token")
  end
end
