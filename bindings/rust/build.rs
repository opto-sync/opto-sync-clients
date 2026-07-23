fn main() {
    println!("cargo:rerun-if-changed=../../core/src/syncer.c");
    println!("cargo:rerun-if-changed=../../core/src/yyjson.c");
    println!("cargo:rerun-if-changed=../../core/include/syncer.h");

    cc::Build::new()
        .file("../../core/src/syncer.c")
        .file("../../core/src/yyjson.c")
        .include("../../core/include")
        .compile("syncer");
}
