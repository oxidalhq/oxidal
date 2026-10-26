fn main() {
    println!("cargo:rerun-if-env-changed=OXIDAL_TONE3000_LIB_DIR");
    println!("cargo:rerun-if-env-changed=OXIDAL_TONE3000_RELOCATABLE");
    if std::env::var_os("CARGO_FEATURE_NATIVE").is_some() {
        let dir = std::env::var("OXIDAL_TONE3000_LIB_DIR")
            .expect("Build the verified offline adapter with pnpm native:check first");
        let path = std::path::Path::new(&dir);
        let file = match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
            Ok("macos") => "liboxidal_tone3000.dylib",
            Ok("linux") => "liboxidal_tone3000.so",
            _ => panic!("Native adapter supports macOS and Linux targets"),
        };
        assert!(
            path.is_absolute() && path.join(file).is_file(),
            "Native adapter library missing for target OS"
        );
        println!("cargo:rerun-if-changed={}", path.join(file).display());
        println!("cargo:rustc-link-search=native={dir}");
        println!("cargo:rustc-link-lib=dylib=oxidal_tone3000");
        if std::env::var_os("OXIDAL_TONE3000_RELOCATABLE").is_some() {
            assert_eq!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("linux"));
            println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        } else {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
        }
    }
}
