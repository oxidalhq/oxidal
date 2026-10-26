use std::{env, path::PathBuf, process::Command};
fn run(command: &mut Command) {
    assert!(
        command.status().expect("build command").success(),
        "{command:?}"
    );
}
fn main() {
    println!("cargo:rerun-if-changed=native/host.c");
    println!("cargo:rerun-if-changed=tests/fixtures");
    if env::var_os("CARGO_FEATURE_NATIVE").is_none() {
        return;
    }
    assert_eq!(
        env::var("CARGO_CFG_TARGET_OS").unwrap(),
        "linux",
        "LV2 qualification currently requires Linux"
    );
    assert_eq!(
        env::var("HOST").unwrap(),
        env::var("TARGET").unwrap(),
        "Use a native Linux build host"
    );
    let flags = Command::new("pkg-config")
        .args(["--cflags", "--libs", "lilv-0"])
        .output()
        .expect("Install pkg-config and liblilv-dev");
    assert!(flags.status.success(), "Install liblilv-dev and lv2-dev");
    let flags = String::from_utf8(flags.stdout).unwrap();
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut cc = Command::new("cc");
    cc.args([
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-fPIC",
        "-c",
        "native/host.c",
        "-o",
    ])
    .arg(out.join("host.o"));
    for flag in flags.split_whitespace().filter(|s| s.starts_with("-I")) {
        cc.arg(flag);
    }
    run(&mut cc);
    run(Command::new("ar")
        .arg("crs")
        .arg(out.join("liboxidal_lv2.a"))
        .arg(out.join("host.o")));
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=oxidal_lv2");
    for flag in flags.split_whitespace() {
        if let Some(lib) = flag.strip_prefix("-l") {
            println!("cargo:rustc-link-lib={lib}");
        }
        if let Some(path) = flag.strip_prefix("-L") {
            println!("cargo:rustc-link-search=native={path}");
        }
    }
    println!("cargo:rustc-link-lib=pthread");
    // Project-authored plugin fixture, built with the same official ABI as external plugins.
    let bundle = out.join("contract.lv2");
    std::fs::create_dir_all(&bundle).unwrap();
    for name in ["manifest.ttl", "plugin.ttl"] {
        std::fs::copy(format!("tests/fixtures/{name}"), bundle.join(name)).unwrap();
    }
    run(Command::new("cc")
        .args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-shared",
            "-fPIC",
            "tests/fixtures/plugin.c",
            "-o",
        ])
        .arg(bundle.join("plugin.so")));
    println!("cargo:rustc-env=OXIDAL_LV2_FIXTURE={}", bundle.display());
}
