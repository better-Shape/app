use sha2::{Digest, Sha256};

pub fn normalize_project_path_for_key(path: &str) -> String {
    let mut n = if cfg!(windows) { path.trim().replace('\\', "/").to_lowercase() } else { path.to_string() };
    while n.ends_with('/') && n.len() > if cfg!(windows) && n.as_bytes().get(1) == Some(&b':') { 3 } else { 1 } { n.pop(); }
    n
}

pub fn stable_project_key(p: &str) -> String { format!("{:x}", Sha256::digest(normalize_project_path_for_key(p).as_bytes())) }

pub fn betterbetterbetterbettershape_index_key(p: &str) -> String {
    let k = stable_project_key(p);
    let b = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from(".")).join("bettershape-index");
    let (d, l) = (b.join(&k), b.join(format!("{:x}", p.bytes().fold(5381u64, |a, c| a.wrapping_mul(33).wrapping_add(c as u64)))));
    if l != d && l.exists() {
        let _ = std::fs::create_dir_all(&d);
        for f in ["index.bin", "overview.json", "manifest.json"] { if l.join(f).exists() && !d.join(f).exists() { if let Err(e) = std::fs::copy(l.join(f), d.join(f)) { log::warn!("index copy {f}: {e}"); } } }
    }
    k
}

pub fn legacy_sip_hash(input: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut h);
    h.finish()
}
