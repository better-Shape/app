/// Output-owned readiness survives event loss; revisions order event and IPC delivery.
#[derive(Clone, Default)]
pub(super) struct PreviewReadiness {
    pub url: Option<String>,
    pub revision: u64,
}

impl PreviewReadiness {
    /// Return an exact JSON ordinal, or revoke retained authority at its representation limit.
    pub fn record(&mut self, url: String) -> Option<u64> {
        // The renderer compares JSON numbers, so never publish an inexact ordinal.
        if self.revision >= 9_007_199_254_740_991 {
            self.url = None;
            return None;
        }
        self.revision += 1;
        self.url = Some(url);
        Some(self.revision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_the_latest_url_with_a_strictly_increasing_revision() {
        let mut ready = PreviewReadiness::default();
        assert_eq!(ready.record("http://localhost:5173".into()), Some(1));
        let before = ready.clone();
        assert_eq!(ready.record("http://localhost:5174".into()), Some(2));
        assert_eq!(before.url.as_deref(), Some("http://localhost:5173"));
        assert_eq!(ready.url.as_deref(), Some("http://localhost:5174"));
        assert!(ready.revision > before.revision);
    }

    #[test]
    fn refuses_to_publish_an_inexact_json_revision() {
        let mut ready = PreviewReadiness {
            url: Some("http://localhost:5173".into()),
            revision: 9_007_199_254_740_991,
        };
        assert_eq!(ready.record("http://localhost:5174".into()), None);
        assert!(ready.url.is_none());
        assert_eq!(ready.revision, 9_007_199_254_740_991);
    }
}
