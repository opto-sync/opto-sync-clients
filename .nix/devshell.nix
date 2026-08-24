{ pkgs, oresSops, oresSopsShellHook }:
pkgs.mkShell {
  packages = [
    (pkgs.rust-bin.stable."1.88.0".default.override {
      extensions = [
        "clippy"
        "rust-src"
        "rustfmt"
      ];
    })
  ]
  ++ (with pkgs; [
    actionlint
    age
    cmake
    git
    jdk21_headless
    just
    nodejs_22
    pkg-config
    python312
    sops
    shellcheck
    sqlite
  ])
  ++ [ oresSops ]
  ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.libiconv ];

  LANG = if pkgs.stdenv.hostPlatform.isDarwin then "en_US.UTF-8" else "C.UTF-8";
  LC_ALL = if pkgs.stdenv.hostPlatform.isDarwin then "en_US.UTF-8" else "C.UTF-8";

  shellHook = ''
    ${oresSopsShellHook}
    mkdir -p env/enc env/dec
    chmod 700 env/dec
    echo "opto-sync client environment: just verify"
  '';
}
