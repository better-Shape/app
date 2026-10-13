use crate::core::error::AppError;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Default)]
struct IpcConfinementState {
    project_root: Option<PathBuf>,
    extra_roots: Vec<PathBuf>,
    granted_paths: HashSet<PathBuf>,
}

fn ipc_lock() -> std::sync::MutexGuard<'static, IpcConfinementState> {
    static S: OnceLock<Mutex<IpcConfinementState>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(IpcConfinementState::default()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

pub fn resolve_path_for_confinement(p: &Path) -> Result<PathBuf, AppError> {
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Path traversal (..).".into()));
    }
    if p.exists() || p.symlink_metadata().is_ok() {
        return p
            .canonicalize()
            .map_err(|e| AppError::Message(e.to_string()));
    }
    let (mut t, mut c) = (Vec::new(), p);
    while let Some(pr) = c.parent() {
        if let Some(n) = c.file_name() {
            t.push(n.to_os_string());
        }
        if pr.as_os_str().is_empty() {
            break;
        }
        if pr.exists() || pr.symlink_metadata().is_ok() {
            let mut b = pr
                .canonicalize()
                .map_err(|e| AppError::Message(e.to_string()))?;
            for x in t.into_iter().rev() {
                b.push(x);
            }
            return Ok(b);
        }
        c = pr;
    }
    Ok(p.to_path_buf())
}

fn canonical_or_raw(p: &Path) -> PathBuf {
    resolve_path_for_confinement(p).unwrap_or_else(|_| p.to_path_buf())
}

pub fn set_ipc_project_root(root: Option<&str>) {
    let mut g = ipc_lock();
    g.project_root = root
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| canonical_or_raw(Path::new(s)));
    g.extra_roots.clear();
    g.granted_paths.clear();
}

pub fn set_ipc_extra_roots(roots: Vec<String>) -> Result<(), AppError> {
    let mut next = Vec::new();
    for s in roots
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        assert_ipc_sensitive_only(&s)?;
        next.push(resolve_path_for_confinement(Path::new(&s))?);
    }
    ipc_lock().extra_roots = next;
    Ok(())
}

pub fn grant_ipc_path(path: &str) -> Result<(), AppError> {
    assert_ipc_sensitive_only(path)?;
    let r = resolve_path_for_confinement(Path::new(path))?;
    if r.is_dir() {
        return Err(AppError::Message("Cannot grant directory access.".into()));
    }
    ipc_lock().granted_paths.insert(r);
    Ok(())
}

pub fn is_protected_workspace_root(path: &str) -> bool {
    resolve_path_for_confinement(Path::new(path))
        .map(|r| {
            let g = ipc_lock();
            g.project_root.as_ref() == Some(&r) || g.extra_roots.contains(&r)
        })
        .unwrap_or(false)
}

fn builtin_allowed_roots() -> Vec<PathBuf> {
    let mut r: Vec<PathBuf> = [dirs::data_local_dir(), dirs::config_dir(), dirs::data_dir()]
        .into_iter()
        .flatten()
        .map(|d| canonical_or_raw(&d.join("BetterShape")))
        .collect();
    r.push(canonical_or_raw(
        &std::env::temp_dir().join("bettershape-design-sandbox"),
    ));
    if let Some(h) = dirs::home_dir() {
        for s in [".shape", ".claude", ".cursor", ".agents"] {
            r.push(canonical_or_raw(&h.join(s)));
        }
    }
    r
}

fn is_bettershape_app_mcp_json(p: &Path) -> bool {
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("mcp.json"))
        .unwrap_or(false)
        && [dirs::data_local_dir(), dirs::config_dir(), dirs::data_dir()]
            .into_iter()
            .flatten()
            .any(|b| {
                canonical_or_raw(p) == canonical_or_raw(&b.join("BetterShape").join("mcp.json"))
            })
}

/// Sensitive file patterns that the AI should never read or write.
/// Matched case-insensitively (CVE-2025-59944 class: Windows/macOS FS).
const SENSITIVE_PATTERNS: &[&str] = &[
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    "credentials.json",
    "service-account.json",
    "secrets.json",
    "token.json",
    ".npmrc",
    ".pypirc",
    "shadow",
    "passwd",
    // Editor / agent config that can lead to RCE if silently rewritten
    // (CVE-2025-61590 / CVE-2025-32018 / CVE-2025-54130 follow-on classes).
    "tasks.json",
    "launch.json",
    "mcp.json",
    "cli.json",
];

/// Filename suffixes matched case-insensitively.
const SENSITIVE_SUFFIXES: &[&str] = &[".pem", ".key", ".p12", ".pfx", ".code-workspace"];

/// Globs for ripgrep / walkers — keep in sync with `is_sensitive_path`.
pub const SENSITIVE_RG_GLOBS: &[&str] = &[
    "!.env",
    "!.env.*",
    "!*.env",
    "!id_rsa",
    "!id_ed25519",
    "!id_ecdsa",
    "!*.pem",
    "!*.key",
    "!*.p12",
    "!*.pfx",
    "!credentials.json",
    "!service-account.json",
    "!secrets.json",
    "!token.json",
    "!.npmrc",
    "!.pypirc",
    "!.git",
    "!.ssh",
    "!.gnupg",
    "!.aws",
];

/// Editor config dirs — `settings.json` only sensitive inside these.
const EDITOR_CONFIG_DIRS: &[&str] = &[".vscode", ".cursor", ".shape", ".claude", ".agents"];

/// Directories that should never be written to by the AI.
const PROTECTED_DIRS: &[&str] = &[
    ".git", ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker",
];

fn ascii_eq_ignore_case(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn ascii_ends_with_ignore_case(value: &str, suffix: &str) -> bool {
    let v = value.as_bytes();
    let s = suffix.as_bytes();
    if s.len() > v.len() {
        return false;
    }
    v[v.len() - s.len()..].eq_ignore_ascii_case(s)
}

fn under_editor_config_dir(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(c) = component {
            let c_str = c.to_string_lossy();
            for dir in EDITOR_CONFIG_DIRS {
                if ascii_eq_ignore_case(&c_str, dir) {
                    return true;
                }
            }
        }
    }
    false
}

/// Resolve a user-provided path to an absolute path within the project root.
/// Returns an error if the path escapes the project boundary.
pub fn resolve_safe_path(user_path: &str, project_root: &str) -> Result<PathBuf, AppError> {
    if project_root.is_empty() {
        return Err(AppError::Message(
            "No project is open. Cannot resolve path.".to_string(),
        ));
    }

    let root = PathBuf::from(project_root);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::Message(format!("Cannot resolve project root: {}", e)))?;

    // Strip leading separators to prevent absolute path injection
    let cleaned = user_path.trim_start_matches('/').trim_start_matches('\\');

    // Block explicit traversal patterns before resolution
    if cleaned.contains("..") {
        return Err(AppError::Message(
            "Path traversal (..) is not allowed.".to_string(),
        ));
    }

    let target = if Path::new(user_path).is_absolute() {
        PathBuf::from(user_path)
    } else {
        root.join(cleaned)
    };

    // For existing paths, canonicalize to resolve symlinks
    let resolved = if target.exists() {
        target
            .canonicalize()
            .map_err(|e| AppError::Message(format!("Cannot resolve path: {}", e)))?
    } else {
        // For new files, canonicalize the parent and append the filename
        if let Some(parent) = target.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| AppError::Message(format!("Cannot resolve parent: {}", e)))?;
                if let Some(file_name) = target.file_name() {
                    canonical_parent.join(file_name)
                } else {
                    return Err(AppError::Message("Invalid file path.".to_string()));
                }
            } else {
                // Parent doesn't exist yet — validate each component has no traversal
                let mut check = canonical_root.clone();
                for component in target.strip_prefix(&root).unwrap_or(&target).components() {
                    match component {
                        std::path::Component::Normal(c) => check.push(c),
                        std::path::Component::ParentDir => {
                            return Err(AppError::Message(
                                "Path traversal (..) is not allowed.".to_string(),
                            ));
                        }
                        _ => {}
                    }
                }
                check
            }
        } else {
            target
        }
    };

    // Path::starts_with matches whole components (not string prefixes), so
    // C:\proj does not authorize C:\proj-evil (CVE-2025-54794 class).
    if !resolved.starts_with(&canonical_root) {
        return Err(AppError::Message(format!(
            "Access denied: path '{}' is outside the project directory.",
            user_path
        )));
    }

    Ok(resolved)
}

/// Template env files are safe to read (no secrets); real `.env*` stay blocked.
fn is_env_template_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".env.example" | ".env.sample" | ".env.template"
    )
}

/// Check if a file path targets a sensitive file that should not be accessible.
pub fn is_sensitive_path(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    // Any `.env*` / `*.env` variant (`.env.staging`, `local.env`, …), except templates.
    if ascii_eq_ignore_case(name, ".env")
        || (name.to_ascii_lowercase().starts_with(".env.") && !is_env_template_name(name))
        || ascii_ends_with_ignore_case(name, ".env")
    {
        return true;
    }

    for pattern in SENSITIVE_PATTERNS {
        if ascii_eq_ignore_case(name, pattern) {
            return true;
        }
    }
    for suffix in SENSITIVE_SUFFIXES {
        if ascii_ends_with_ignore_case(name, suffix) {
            return true;
        }
    }

    // settings.json under editor config dirs only (CVE-2025-54130 class).
    if ascii_eq_ignore_case(name, "settings.json") && under_editor_config_dir(path) {
        return true;
    }

    // Check if any component is a protected directory (case-insensitive).
    for component in path.components() {
        if let std::path::Component::Normal(c) = component {
            let c_str = c.to_string_lossy();
            for dir in PROTECTED_DIRS {
                if ascii_eq_ignore_case(&c_str, dir) {
                    return true;
                }
            }
        }
    }

    false
}

pub fn assert_ipc_sensitive_only(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Message("Path cannot be empty.".into()));
    }
    let p = PathBuf::from(path);
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::Message(
            "Path traversal (..) is not allowed.".into(),
        ));
    }
    if is_bettershape_app_mcp_json(&p) {
        return Ok(());
    }
    if is_sensitive_path(&p)
        || [
            "/.ssh/",
            "/.aws/",
            "/.gnupg/",
            "/.kube/",
            "/.azure/",
            "/.config/gcloud/",
            "/.docker/",
        ]
        .iter()
        .any(|m| path.replace('\\', "/").to_ascii_lowercase().contains(m))
    {
        return Err(AppError::Message(format!(
            "Access denied: '{path}' is sensitive."
        )));
    }
    Ok(())
}

pub fn assert_ipc_path_allowed(path: &str) -> Result<(), AppError> {
    assert_ipc_sensitive_only(path)?;
    let (pr, er, gp) = {
        let g = ipc_lock();
        (
            g.project_root.clone(),
            g.extra_roots.clone(),
            g.granted_paths.clone(),
        )
    };
    let r = resolve_path_for_confinement(Path::new(path))?;
    if is_sensitive_path(&r) && !is_bettershape_app_mcp_json(&r) {
        return Err(AppError::Message(format!(
            "Access denied: '{path}' is sensitive."
        )));
    }
    if pr.as_ref().map(|x| r.starts_with(x)).unwrap_or(false)
        || er.iter().any(|x| r.starts_with(x))
        || gp.contains(&r)
        || builtin_allowed_roots().iter().any(|x| r.starts_with(x))
    {
        return Ok(());
    }
    Err(AppError::Message(format!(
        "Access denied: '{path}' is outside workspace."
    )))
}

/// Canonicalize `path` and reject credential targets.
pub fn canonicalize_ipc_path(path: &str) -> Result<PathBuf, AppError> {
    let resolved = PathBuf::from(path).canonicalize().map_err(AppError::Io)?;
    assert_ipc_path_allowed(&resolved.to_string_lossy())?;
    Ok(resolved)
}

/// `path` must already be canonical. Rejects siblings that only share a prefix
/// (`…/skills-extra` is not inside `…/skills`).
pub fn assert_resolved_within(path: &Path, root: &Path) -> Result<(), AppError> {
    if path.starts_with(root) {
        return Ok(());
    }
    Err(AppError::Message(format!(
        "Access denied: '{}' is outside '{}'.",
        path.display(),
        root.display()
    )))
}

/// Validate a path for read operations. Ensures it's within project and not sensitive.
pub fn validate_read_path(user_path: &str, project_root: &str) -> Result<PathBuf, AppError> {
    let resolved = resolve_safe_path(user_path, project_root)?;

    if is_sensitive_path(&resolved) {
        return Err(AppError::Message(format!(
            "Access denied: '{}' is a sensitive file and cannot be read by the AI.",
            user_path
        )));
    }

    Ok(resolved)
}

/// Validate a path for write operations. More restrictive than read.
pub fn validate_write_path(user_path: &str, project_root: &str) -> Result<PathBuf, AppError> {
    let resolved = resolve_safe_path(user_path, project_root)?;

    if is_sensitive_path(&resolved) {
        return Err(AppError::Message(format!(
            "Access denied: '{}' is a sensitive/protected file and cannot be modified by the AI.",
            user_path
        )));
    }

    Ok(resolved)
}

/// Validate a path for delete operations. Most restrictive — no directory deletion.
pub fn validate_delete_path(user_path: &str, project_root: &str) -> Result<PathBuf, AppError> {
    let resolved = resolve_safe_path(user_path, project_root)?;

    if is_sensitive_path(&resolved) {
        return Err(AppError::Message(format!(
            "Access denied: '{}' is a protected path and cannot be deleted.",
            user_path
        )));
    }

    // Prevent bulk-deletion of directories by the AI
    if resolved.is_dir() {
        return Err(AppError::Message(
            "The AI cannot delete directories. Only individual files can be deleted. \
             If you need to remove a directory, please do it manually."
                .to_string(),
        ));
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_traversal_blocked() {
        let result = resolve_safe_path("../../etc/passwd", "C:\\test\\project");
        assert!(result.is_err());
    }

    #[test]
    fn test_sensitive_detection() {
        assert!(is_sensitive_path(Path::new("/project/.env")));
        assert!(is_sensitive_path(Path::new("/project/.env.local")));
        assert!(is_sensitive_path(Path::new("/project/.git/config")));
        assert!(is_sensitive_path(Path::new("/project/id_rsa")));
        assert!(!is_sensitive_path(Path::new("/project/src/main.rs")));
        assert!(!is_sensitive_path(Path::new("/project/.env.example")));
        assert!(!is_sensitive_path(Path::new("/project/.env.sample")));
        assert!(!is_sensitive_path(Path::new("/project/.env.template")));
    }

    #[test]
    fn test_sensitive_case_insensitive() {
        assert!(is_sensitive_path(Path::new("/project/.ENV")));
        assert!(is_sensitive_path(Path::new("/project/.Git/config")));
        assert!(is_sensitive_path(Path::new("/project/Id_Rsa")));
        assert!(is_sensitive_path(Path::new("/project/.vscode/Tasks.json")));
        assert!(is_sensitive_path(Path::new("/project/Foo.CODE-WORKSPACE")));
        assert!(is_sensitive_path(Path::new("/project/.cursor/MCP.json")));
        assert!(is_sensitive_path(Path::new(
            "/project/.vscode/settings.json"
        )));
        assert!(is_sensitive_path(Path::new(
            "/project/.VsCode/Settings.JSON"
        )));
        assert!(!is_sensitive_path(Path::new("/project/app/settings.json")));
        assert!(is_sensitive_path(Path::new(
            "/project/.git/hooks/pre-commit"
        )));
    }

    #[test]
    fn resolved_file_must_stay_inside_its_root() {
        let temp =
            std::env::temp_dir().join(format!("bettershape-skill-root-{}", std::process::id()));
        let root = temp.join("skills");
        let sibling = temp.join("skills-extra");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let inside = root.join("notes.md");
        let outside = sibling.join("notes.md");
        std::fs::write(&inside, "skill").unwrap();
        std::fs::write(&outside, "other").unwrap();

        let root_real = root.canonicalize().unwrap();
        assert!(assert_resolved_within(&inside.canonicalize().unwrap(), &root_real).is_ok());
        assert!(assert_resolved_within(&outside.canonicalize().unwrap(), &root_real).is_err());

        let link = root.join("linked.md");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, &link);
        if linked.is_ok() {
            let resolved = link.canonicalize().unwrap();
            assert!(
                assert_resolved_within(&resolved, &root_real).is_err(),
                "a symlink inside the skill root must not resolve outside it"
            );
        }

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn resolved_file_must_stay_inside_its_root() {
        let temp = std::env::temp_dir().join(format!(
            "shape-skill-root-{}",
            std::process::id()
        ));
        let root = temp.join("skills");
        let sibling = temp.join("skills-extra");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let inside = root.join("notes.md");
        let outside = sibling.join("notes.md");
        std::fs::write(&inside, "skill").unwrap();
        std::fs::write(&outside, "other").unwrap();

        let root_real = root.canonicalize().unwrap();
        assert!(assert_resolved_within(&inside.canonicalize().unwrap(), &root_real).is_ok());
        assert!(assert_resolved_within(&outside.canonicalize().unwrap(), &root_real).is_err());

        let link = root.join("linked.md");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, &link);
        if linked.is_ok() {
            let resolved = link.canonicalize().unwrap();
            assert!(
                assert_resolved_within(&resolved, &root_real).is_err(),
                "a symlink inside the skill root must not resolve outside it"
            );
        }

        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_allows_project_relative_paths() {
        let temp = std::env::temp_dir().join("bettershape-path-security-test");
        let _ = std::fs::create_dir_all(&temp);
        let root = temp.to_string_lossy();
        let result = resolve_safe_path("src/main.ts", root.as_ref());
        assert!(result.is_ok());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_ipc_confinement_blocks_outside_and_prefix_sibling() {
        let b = std::env::temp_dir().join("bettershape-ipc-confinement-test");
        let (p, s) = (b.join("proj"), b.join("proj-evil"));
        let _ = (std::fs::create_dir_all(&p), std::fs::create_dir_all(&s));
        let (i, o) = (p.join("a.ts"), s.join("b.txt"));
        let _ = (std::fs::write(&i, ""), std::fs::write(&o, ""));
        let (ps, is, os) = (
            p.to_string_lossy().to_string(),
            i.to_string_lossy().to_string(),
            o.to_string_lossy().to_string(),
        );
        set_ipc_project_root(Some(&ps));
        assert!(
            assert_ipc_path_allowed(&is).is_ok()
                && assert_ipc_path_allowed(&p.join(".env").to_string_lossy()).is_err()
                && assert_ipc_path_allowed(&os).is_err()
                && grant_ipc_path(&os).is_ok()
                && assert_ipc_path_allowed(&os).is_ok()
                && grant_ipc_path(&s.to_string_lossy()).is_err()
                && is_protected_workspace_root(&ps)
        );
        set_ipc_project_root(None);
        assert!(assert_ipc_path_allowed(&os).is_err());
        let _ = std::fs::remove_dir_all(&b);
    }
}
