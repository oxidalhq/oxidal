fn main() {
    println!("cargo:rerun-if-env-changed=OXIDAL_TONE3000_LIB_DIR");
    if std::env::var_os("CARGO_FEATURE_NATIVE").is_some() {
        let dir = std::env::var("OXIDAL_TONE3000_LIB_DIR")
            .expect("Build the verified offline adapter with pnpm native:check first");
        let path = std::path::Path::new(&dir);
        assert!(path.is_absolute() && path.join("liboxidal_tone3000.dylib").is_file());
        println!("cargo:rustc-link-search=native={dir}");
        println!("cargo:rustc-link-lib=dylib=oxidal_tone3000");
        println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
    }
}
