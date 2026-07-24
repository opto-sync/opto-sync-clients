defmodule OptoSyncEcto.MixProject do
  use Mix.Project

  def project do
    [
      app: :opto_sync_ecto,
      version: "0.1.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:ecto, "~> 3.10"},
      # {:opto_sync_nif, path: "../../../bindings/beam"}
    ]
  end
end
