// The sign-in configuration is not in git: the Firebase web key comes from the
// environment of whoever builds and is embedded in the binary (it names the
// project and is public by design; desktop/scripts/build.ps1 sets it). The
// tray has no Google OAuth client: it signs in through the web app.
fn main() {
    for name in ["BOTRACING_FIREBASE_API_KEY"] {
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
