defmodule OptoSyncEcto do
  @moduledoc """
  Ecto changeset function for JSONB merging.
  """
  import Ecto.Changeset

  def merge_jsonb(changeset, field, opts \\ []) do
    # Fetch current and incoming values
    # Call to NIF binding to merge
    # Put merged value back in changeset
    changeset
  end
end
