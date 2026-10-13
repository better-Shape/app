use std::collections::HashSet;
use std::sync::Mutex;

pub struct WorkspaceTrustState(pub Mutex<HashSet<String>>);

impl WorkspaceTrustState {
    pub fn new() -> Self {
        Self(Mutex::new(HashSet::new()))
    }

    pub fn normalize(path: &str) -> String {
        let win = cfg!(windows)
            || matches!(path.trim().as_bytes(), [b, b':', ..] if b.is_ascii_alphabetic());
        let mut normalized = if win {
            path.trim().replace('\\', "/").to_lowercase()
        } else {
            path.trim().to_string()
        };
        while normalized.ends_with('/') && normalized.len() > 1 {
            normalized.pop();
        }
        normalized
    }

    pub fn is_trusted(&self, path: &str) -> bool {
        let key = Self::normalize(path);
        self.0.lock().map(|set| set.contains(&key)).unwrap_or(false)
    }

    pub fn set_trusted(&self, path: &str, trusted: bool) {
        let key = Self::normalize(path);
        if let Ok(mut set) = self.0.lock() {
            if trusted {
                set.insert(key);
            } else {
                set.remove(&key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_trailing_slash() {
        assert_eq!(
            WorkspaceTrustState::normalize("C:/Projects/App/"),
            "c:/projects/app"
        );
    }

    #[test]
    fn trust_roundtrip() {
        let state = WorkspaceTrustState::new();
        assert!(!state.is_trusted("C:/foo"));
        state.set_trusted("C:/foo", true);
        assert!(state.is_trusted("C:/foo"));
        state.set_trusted("C:/foo", false);
        assert!(!state.is_trusted("C:/foo"));
    }
}
