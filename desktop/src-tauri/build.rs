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
    tauri_build::build()
}
