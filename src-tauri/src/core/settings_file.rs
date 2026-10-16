//! Fixed-path settings storage. Reads must distinguish absence from corrupt legacy bytes.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};

const MAX_BYTES: usize = 8 * 1024 * 1024;
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

/// Settings access is independent of the close-consent policy for other window kinds.
pub fn is_settings_window(label: &str) -> bool {
    matches!(
        label,
        "main" | "settings" | "onboarding" | "branch" | "git" | "stats"
    ) || label.starts_with("popout-")
        || label.starts_with("preview-")
}

#[derive(Clone, Copy)]
pub enum SettingsFile {
    Primary,
    Preferences,
}

impl SettingsFile {
    pub fn parse(name: &str) -> Result<Self, &'static str> {
        match name {
            "settings.json" => Ok(Self::Primary),
            "settings-preferences.json" => Ok(Self::Preferences),
            _ => Err("Unknown settings file"),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Primary => "settings.json",
            Self::Preferences => "settings-preferences.json",
        }
    }
}

pub fn read(root: &Path, file: SettingsFile) -> Result<Option<Value>, &'static str> {
    let path = root.join(file.name());
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {}
        Ok(_) => return Err("Settings file is not a regular file"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Settings file cannot be read"),
    }
    open_settings_file(&path)
}

/// Open the settings file and verify the file we actually read.
///
/// The `symlink_metadata` check above is only a hint: the entry can be replaced
/// between it and this open, so the open handle - not that stat - decides what is
/// readable. On Unix the entry must still resolve to the same device and inode as the
/// handle, which rejects a symlink (or a swapped file) without needing platform flags;
/// elsewhere the handle's own file type has to be a regular file.
fn open_settings_file(path: &Path) -> Result<Option<Value>, &'static str> {
    let file = open_entry(path)?;
    let opened = file
        .metadata()
        .map_err(|_| "Settings file cannot be read")?;
    if !opened.is_file() {
        return Err("Settings file is not a regular file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let entry = fs::symlink_metadata(path).map_err(|_| "Settings file cannot be read")?;
        if entry.file_type().is_symlink()
            || entry.dev() != opened.dev()
            || entry.ino() != opened.ino()
        {
            return Err("Settings file is not a regular file");
        }
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Settings file cannot be read")?;
    if bytes.len() > MAX_BYTES {
        return Err("Settings file is too large");
    }
    let record: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Settings file is not valid JSON")?;
    if !record.is_object() {
        return Err("Settings file is not an object");
    }
    if record
        .get("settings")
        .is_some_and(|settings| !settings.is_object() && !settings.is_null())
    {
        return Err("Settings record is not an object");
    }
    Ok(Some(record))
}

/// Open the settings entry without following a link that replaced it since the stat above.
///
/// On Unix the device/inode comparison in `open_settings_file` rejects a swapped entry even when
/// the open followed it. Windows has no equivalent stable accessor through `File`, so the handle
/// is opened with `FILE_FLAG_OPEN_REPARSE_POINT`: a symlink then arrives as the link itself, whose
/// attributes fail the regular-file check instead of being followed to an arbitrary target.
fn open_entry(path: &Path) -> Result<File, &'static str> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
        .open(path)
        .map_err(|_| "Settings file cannot be read")
}

struct BoundedBytes(Vec<u8>);
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_BYTES {
            return Err(std::io::Error::other("Settings file is too large"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn validate_preferences(settings: &Value) -> Result<(), &'static str> {
    if !settings.is_object() {
        return Err("Settings must be an object");
    }
    for kind in ["connections", "services"] {
        let Some(providers) = settings.pointer(&format!("/ai/providers/{kind}")) else {
            continue;
        };
        let providers = providers
            .as_object()
            .ok_or("Provider settings must be objects")?;
        for (id, provider) in providers {
            let provider = provider
                .as_object()
                .ok_or("Provider settings must be objects")?;
            if provider
                .get("apiKey")
                .is_some_and(|key| key.as_str() != Some(""))
            {
                return Err("Provider credentials must use the keychain");
            }
            if let Some(headers) = provider.get("headers") {
                for (name, value) in headers
                    .as_object()
                    .ok_or("Provider headers must be an object")?
                {
                    let public = super::provider_header_defaults::public_header_default(id, name);
                    if value.as_str() != Some("")
                        && (value.as_str().is_none() || value.as_str() != public)
                    {
                        return Err("Provider credentials must use the keychain");
                    }
                }
            }
        }
    }
    Ok(())
}

/// The command owner holds one process-wide mutex across comparison and replacement.
/// Temporary files contain only the new redacted record, never a legacy backup.
pub fn write(
    root: &Path,
    file: SettingsFile,
    settings: Value,
    expected: Option<Value>,
) -> Result<(), &'static str> {
    validate_preferences(&settings)?;
    let current = read(root, file)?;
    if current != expected {
        return Err("Settings changed before they could be saved");
    }
    if current
        .as_ref()
        .and_then(Value::as_object)
        .is_some_and(|record| record.keys().any(|key| key != "settings"))
    {
        return Err("Settings file contains unowned data");
    }
    // The record is replaced wholesale, so a key this build does not know about must block the
    // write instead of disappearing with it. The check is deliberately one level deep: deleting
    // an entry *inside* a branch this build models is a first-class action - removing a provider
    // connection, a header or a shortcut writes a value that no longer carries that entry - and a
    // path-level check would refuse every one of those writes. Unknown nested fields are
    // therefore the writer's responsibility: the renderer preserves the fields it read when it
    // rewrites the record it owns (`mergeSettingsOverlay` in `lib/settings/store.ts`).
    if matches!(file, SettingsFile::Primary)
        && current
            .as_ref()
            .and_then(|record| record.get("settings"))
            .and_then(Value::as_object)
            .is_some_and(|old| old.keys().any(|key| settings.get(key).is_none()))
    {
        return Err("Settings record contains unowned fields");
    }
    let record = json!({ "settings": settings });
    let mut bytes = BoundedBytes(Vec::new());
    serde_json::to_writer(&mut bytes, &record)
        .map_err(|_| "Settings exceed the encoding size limit")?;
    fs::create_dir_all(root).map_err(|_| "Settings directory cannot be created")?;
    let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let temporary = root.join(format!(".{}.{}.{id}.tmp", file.name(), std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(&temporary)
        .map_err(|_| "Settings cannot be staged")?;
    let result = output.write_all(&bytes.0).and_then(|()| output.sync_all());
    drop(output);
    let result = result.and_then(|()| fs::rename(&temporary, root.join(file.name())));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| "Settings could not be saved")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Directory(std::path::PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "bettershape-settings-test-{}-{}",
                std::process::id(),
                TEMP_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn persists_preferences_while_preserving_corrupt_primary_bytes() {
        let root = Directory::new();
        let original = br#"{"settings":{"apiKey":"example-incomplete""#;
        fs::write(root.0.join("settings.json"), original).unwrap();
        assert!(read(&root.0, SettingsFile::Primary).is_err());
        assert!(write(&root.0, SettingsFile::Primary, json!({}), None).is_err());
        write(
            &root.0,
            SettingsFile::Preferences,
            json!({"editor":{"fontSize":23}}),
            None,
        )
        .unwrap();
        assert_eq!(
            read(&root.0, SettingsFile::Preferences).unwrap().unwrap()["settings"]["editor"]
                ["fontSize"],
            23
        );
        assert_eq!(fs::read(root.0.join("settings.json")).unwrap(), original);
    }

    #[test]
    fn rejects_secret_writes_and_accepts_public_defaults() {
        let root = Directory::new();
        for provider in [
            json!({"apiKey":"example-draft"}),
            json!({"headers":{"Authorization":"example-header"}}),
            json!({"apiKey":null}),
        ] {
            assert!(write(
                &root.0,
                SettingsFile::Preferences,
                json!({"ai":{"providers":{"connections":{"openai":provider}}}}),
                None
            )
            .is_err());
        }
        let settings = json!({"ai":{"providers":{"connections":{"openrouter":{"apiKey":"","headers":{"X-Title":"BetterShape","Authorization":""}}}}}});
        write(&root.0, SettingsFile::Preferences, settings.clone(), None).unwrap();
        assert_eq!(
            read(&root.0, SettingsFile::Preferences).unwrap(),
            Some(json!({"settings":settings}))
        );
    }

    #[test]
    fn compare_and_replace_preserves_a_changed_original() {
        let root = Directory::new();
        write(
            &root.0,
            SettingsFile::Primary,
            json!({"editor":{"fontSize":19}}),
            None,
        )
        .unwrap();
        let before = read(&root.0, SettingsFile::Primary).unwrap();
        write(
            &root.0,
            SettingsFile::Primary,
            json!({"editor":{"fontSize":21}}),
            before.clone(),
        )
        .unwrap();
        assert!(write(&root.0, SettingsFile::Primary, json!({}), before).is_err());
        assert_eq!(
            read(&root.0, SettingsFile::Primary).unwrap().unwrap()["settings"]["editor"]
                ["fontSize"],
            21
        );
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
    }

    #[test]
    fn rejects_unknown_names_and_unowned_data() {
        for name in [
            "../settings.json",
            "/settings.json",
            "other.json",
            "settings.json/child",
        ] {
            assert!(SettingsFile::parse(name).is_err());
        }
        assert!(SettingsFile::parse("settings.json").is_ok());
        assert!(SettingsFile::parse("settings-preferences.json").is_ok());
        let root = Directory::new();
        let original = json!({"settings":{},"unowned":"keep"});
        fs::write(
            root.0.join("settings.json"),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
        assert!(write(
            &root.0,
            SettingsFile::Primary,
            json!({}),
            Some(original.clone())
        )
        .is_err());
        assert_eq!(
            read(&root.0, SettingsFile::Primary).unwrap(),
            Some(original)
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_targets() {
        let root = Directory::new();
        let outside = Directory::new();
        let target = outside.0.join("private.json");
        fs::write(&target, b"{}").unwrap();
        std::os::unix::fs::symlink(&target, root.0.join("settings.json")).unwrap();
        assert!(read(&root.0, SettingsFile::Primary).is_err());
        assert!(write(&root.0, SettingsFile::Primary, json!({}), None).is_err());
        assert_eq!(fs::read(target).unwrap(), b"{}");
    }
    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_replaces_the_entry_before_the_open() {
        let root = Directory::new();
        let outside = Directory::new();
        let path = root.0.join("settings.json");
        fs::write(&path, br#"{"settings":{"local":true}}"#).unwrap();
        // A regular file passes the cheap check and reads normally.
        assert!(read(&root.0, SettingsFile::Primary).is_ok());
        // Then a symlink to another record replaces the entry: the cheap check has
        // already run, so only the opened handle can still tell what was read.
        let target = outside.0.join("private.json");
        fs::write(&target, br#"{"settings":{"outside":true}}"#).unwrap();
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        // Opening the path alone follows the swap, which is why the handle is verified.
        assert_eq!(
            fs::read(&path).unwrap(),
            br#"{"settings":{"outside":true}}"#
        );
        assert!(open_settings_file(&path).is_err());
        assert!(read(&root.0, SettingsFile::Primary).is_err());
        assert_eq!(
            fs::read(&target).unwrap(),
            br#"{"settings":{"outside":true}}"#
        );
    }

    #[test]
    fn bounds_reads_and_writes_without_replacing_existing_data() {
        let root = Directory::new();
        let oversized = "x".repeat(MAX_BYTES + 1);
        fs::write(root.0.join("settings.json"), &oversized).unwrap();
        assert!(read(&root.0, SettingsFile::Primary).is_err());
        assert!(write(
            &root.0,
            SettingsFile::Preferences,
            json!({"oversized":oversized}),
            None
        )
        .is_err());
        assert!(!root.0.join("settings-preferences.json").exists());
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
    }

    #[test]
    fn preserves_unknown_settings_fields_and_rejects_invalid_record_shapes() {
        let root = Directory::new();
        for record in [json!([]), json!({"settings":"example-unknown"})] {
            let bytes = serde_json::to_vec(&record).unwrap();
            fs::write(root.0.join("settings.json"), &bytes).unwrap();
            assert!(read(&root.0, SettingsFile::Primary).is_err());
            assert!(write(&root.0, SettingsFile::Primary, json!({}), Some(record)).is_err());
            assert_eq!(fs::read(root.0.join("settings.json")).unwrap(), bytes);
        }
        let original = json!({"settings":{"futureVersion":{"keep":true}}});
        fs::write(
            root.0.join("settings.json"),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
        assert!(write(
            &root.0,
            SettingsFile::Primary,
            json!({}),
            Some(original.clone())
        )
        .is_err());
        assert_eq!(
            read(&root.0, SettingsFile::Primary).unwrap(),
            Some(original)
        );
    }
    #[test]
    fn allows_deleting_an_entry_inside_a_modelled_branch() {
        // The one-level guard above exists to keep unknown *top-level* fields from being dropped
        // silently. A nested entry is different: removing a provider connection is a normal
        // settings edit, and a path-level check would refuse this write forever.
        let root = Directory::new();
        let original = json!({"settings":{"ai":{"providers":{"connections":{
            "openai":{"model":"gpt"},"openrouter":{"model":"claude"}}}}}});
        fs::write(
            root.0.join("settings.json"),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();
        write(
            &root.0,
            SettingsFile::Primary,
            json!({"ai":{"providers":{"connections":{"openai":{"model":"gpt"}}}}}),
            Some(original),
        )
        .unwrap();
        assert_eq!(
            read(&root.0, SettingsFile::Primary).unwrap().unwrap()["settings"]["ai"]["providers"]
                ["connections"],
            json!({"openai":{"model":"gpt"}})
        );
    }

    #[test]
    fn grants_only_named_application_window_kinds() {
        for label in [
            "main",
            "settings",
            "onboarding",
            "branch",
            "git",
            "stats",
            "popout-editor",
            "preview-project",
        ] {
            assert!(is_settings_window(label));
        }
        for label in [
            "",
            "browser",
            "inspector",
            "settings-other",
            "popout",
            "preview",
        ] {
            assert!(!is_settings_window(label));
        }
    }
}
