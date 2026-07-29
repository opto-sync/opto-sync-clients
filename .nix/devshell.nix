{ pkgs }:
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
    cmake
    git
    jdk21_headless
    nodejs_22
    pkg-config
    python312
    shellcheck
    sqlite
  ])
  ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.libiconv ];

  LANG = if pkgs.stdenv.hostPlatform.isDarwin then "en_US.UTF-8" else "C.UTF-8";
  LC_ALL = if pkgs.stdenv.hostPlatform.isDarwin then "en_US.UTF-8" else "C.UTF-8";
}
