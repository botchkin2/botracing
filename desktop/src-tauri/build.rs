// The sign-in configuration is not in git: the OAuth client and the Firebase
// web key come from the environment of whoever builds, and are embedded in the
// binary (a desktop client's secret is public once installed; PKCE is the
// protection). desktop/scripts/build.ps1 sets them from the local JSON file.
fn main() {
    for name in [
        "BOTRACING_OAUTH_CLIENT_ID",
        "BOTRACING_OAUTH_CLIENT_SECRET",
        "BOTRACING_FIREBASE_API_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
        let value = std::env::var(name).unwrap_or_default();
        println!("cargo:rustc-env={name}={value}");
    }
    // tauri.conf.json bundles resources/app and resources/node, which
    // scripts/stage-resources.mjs fills before an installer build. A plain
    // `cargo build` or `cargo test` has nothing staged, and tauri-build refuses
    // a resource path that does not exist, so make the folders exist (empty).
    for dir in ["resources/app", "resources/node"] {
        std::fs::create_dir_all(dir).expect("could not create the resources folder");
    }
    tauri_build::build()
}
