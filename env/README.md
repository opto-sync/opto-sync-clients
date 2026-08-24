# Encrypted environment lifecycle

This client SDK owns only credential-free development and conformance settings. Applications own service endpoints and credentials and inject them at runtime; do not move provider, database, signing, service-role, or reusable session secrets into this repository.

- `env/enc/dev.env.enc` and `env/enc/prod.env.enc` are the only allowed committed ciphertext profiles.
- `env/dec/*.env` is local plaintext, mode `0600`, ignored everywhere, and removable with `ores-sops lock`.
- `.sops.yaml` contains public age recipients only. Private age identities never enter Git.
- `.env.example` is a credential-free seed contract, not a live environment.

Enter the pinned shell with `nix develop`, then run `just bootstrap`. Use `just seed dev`, edit `env/dec/dev.env`, and run `just encrypt dev` to create the first ciphertext. `just exec-env dev -- command ...` injects decrypted values without writing a new plaintext file. `just refresh` rewraps ciphertext after recipient changes, and `just verify-release-policy prod` proves dev and prod have distinct, recoverable recipient sets without decrypting them.

No ciphertext is fabricated solely to make a directory non-empty. A profile is committed only after its owner and custody are reviewed.
