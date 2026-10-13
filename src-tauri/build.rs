fn main() {
    println!("cargo:rerun-if-changed=../runtime/entry.ts");
    println!("cargo:rerun-if-changed=../scripts/build/preview.mjs");
    // Do not watch the generated bundle — beforeDevCommand writes it on every
    // `tauri dev` start and that would restart the native app in a loop.
    println!("cargo:rerun-if-env-changed=BETTERSHAPE_RAM_DEBUG");
    tauri_build::build()
}
