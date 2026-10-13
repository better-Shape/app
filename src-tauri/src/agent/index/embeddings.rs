//! Local embedding store, filled with the user's own embeddings API.
//!
//! Semantic search used to round-trip to the BetterShape server. It now embeds chunks
//! with the configured OpenAI-compatible `/embeddings` endpoint and keeps the
//! vectors on disk next to the BM25 index, so an offline project still searches
//! by meaning once it has been indexed. When no OpenAI-wire provider is
//! configured, hybrid search silently falls back to BM25 + ripgrep.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Per-request metadata (kept for turn attribution in logs).
#[derive(Debug, Clone, Default)]
pub struct ApiContext {
    /// Model id of the active chat turn (diagnostics only).
    pub model: Option<String>,
    pub turn_id: Option<String>,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredVector {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    /// Chunk text is kept so results can be re-ranked/displayed without re-reading files.
    #[serde(default)]
    pub text: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmbeddingStore {
    pub enabled: bool,
    /// Embedding model the stored vectors were produced with.
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub vectors: Vec<StoredVector>,
}

impl EmbeddingStore {
    pub fn len(&self) -> usize {
        self.vectors.len()
    }

    /// Drop everything (used when a full re-index starts).
    pub fn clear(&mut self) {
        self.vectors.clear();
    }

    /// Add or replace vectors for the given chunks, keyed by file + line range.
    pub fn upsert(&mut self, entries: Vec<StoredVector>) {
        for entry in entries {
            if let Some(existing) = self.vectors.iter_mut().find(|v| {
                v.file_path == entry.file_path
                    && v.start_line == entry.start_line
                    && v.end_line == entry.end_line
            }) {
                *existing = entry;
            } else {
                self.vectors.push(entry);
            }
        }
    }

    /// Remove every vector belonging to files that no longer exist in the index.
    pub fn retain_files(&mut self, keep: &std::collections::HashSet<String>) {
        self.vectors.retain(|v| keep.contains(&v.file_path));
    }

    /// Cosine-similarity search over the stored vectors.
    pub fn search(&self, query: &[f32], top_k: usize) -> Vec<RemoteSearchHit> {
        if query.is_empty() || self.vectors.is_empty() {
            return vec![];
        }
        let query_norm = norm(query);
        let mut scored: Vec<(f64, &StoredVector)> = self
            .vectors
            .iter()
            .filter_map(|entry| {
                if entry.vector.len() != query.len() {
                    return None;
                }
                let denom = query_norm * norm(&entry.vector);
                if denom <= f64::EPSILON {
                    return None;
                }
                let dot: f64 = query
                    .iter()
                    .zip(entry.vector.iter())
                    .map(|(a, b)| (*a as f64) * (*b as f64))
                    .sum();
                Some((dot / denom, entry))
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(top_k)
            .map(|(score, entry)| RemoteSearchHit {
                file: entry.file_path.clone(),
                start_line: entry.start_line,
                end_line: entry.end_line,
                score: score as f32,
            })
            .collect()
    }
}

fn norm(vector: &[f32]) -> f64 {
    vector
        .iter()
        .map(|v| (*v as f64) * (*v as f64))
        .sum::<f64>()
        .sqrt()
}

#[derive(Debug, Clone)]
pub struct RemoteSearchHit {
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
    /// Cosine similarity; ranking uses RRF position instead.
    #[allow(dead_code)]
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChunkPayload {
    pub chunk_index: usize,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}

/// Shared blocking client — never drop a per-request `blocking::Client` on a tokio worker
/// (that panics: "Cannot drop a runtime in a context where blocking is not allowed").
fn blocking_http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    })
}

/// Embeds text with the user's own provider and stores the vectors locally.
pub struct RemoteIndexClient {
    context: ApiContext,
}

impl RemoteIndexClient {
    pub fn new(_project_path: &str, context: ApiContext) -> Self {
        Self { context }
    }

    /// Refresh turn metadata without rebuilding the client (and without
    /// invalidating the in-memory index that owns it).
    pub fn set_context(&mut self, context: ApiContext) {
        self.context = context;
    }

    /// True when an OpenAI-compatible embeddings endpoint is configured.
    pub fn is_available(&self) -> bool {
        crate::core::ai_providers::embeddings_target().is_some()
    }

    /// Embed a batch of texts through the configured provider.
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let (provider, model) =
            crate::core::ai_providers::embeddings_target().ok_or_else(|| {
                "No OpenAI-compatible provider is configured for embeddings. Add an OpenAI, OpenRouter, or custom OpenAI-wire key in Settings → Providers.".to_string()
            })?;
        if let Some(conv) = &self.context.conversation_id {
            let _ = conv;
        }
        let url = format!(
            "{}/embeddings",
            provider.base_url.trim_end_matches('/')
        );
        let body = serde_json::json!({ "model": model, "input": texts });
        let resp = blocking_http_client()
            .post(&url)
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Embeddings request failed: {e}"))?;
        if !resp.status().is_success() {
            let text = resp.text().unwrap_or_default();
            return Err(format!(
                "Embeddings error: {}",
                text.chars().take(300).collect::<String>()
            ));
        }
        let parsed: serde_json::Value = resp
            .json()
            .map_err(|e| format!("Failed to parse embeddings response: {e}"))?;
        let mut out: Vec<Vec<f32>> = Vec::new();
        if let Some(items) = parsed.get("data").and_then(|d| d.as_array()) {
            for item in items {
                let vector = item
                    .get("embedding")
                    .and_then(|e| e.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                            .collect::<Vec<f32>>()
                    })
                    .unwrap_or_default();
                out.push(vector);
            }
        }
        if out.len() != texts.len() {
            return Err("Embeddings response did not match the request size.".to_string());
        }
        Ok(out)
    }

    /// Embed + store chunks locally. Returns the number of stored vectors.
    pub fn sync_chunks(
        &self,
        store: &mut EmbeddingStore,
        chunks: Vec<SyncChunkPayload>,
        full_replace: bool,
    ) -> Result<usize, String> {
        if !self.is_available() {
            return Ok(0);
        }
        if full_replace {
            store.clear();
        }
        if chunks.is_empty() {
            return Ok(store.len());
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = self.embed(&texts)?;
        let entries: Vec<StoredVector> = chunks
            .into_iter()
            .zip(vectors.into_iter())
            .map(|(chunk, vector)| StoredVector {
                file_path: chunk.file_path,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                text: chunk.text,
                vector,
            })
            .collect();
        store.upsert(entries);
        if let Some((_, model)) = crate::core::ai_providers::embeddings_target() {
            store.model = model;
        }
        Ok(store.len())
    }

    /// Embed the query and score it against the locally stored vectors.
    pub fn search(
        &self,
        store: &EmbeddingStore,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<RemoteSearchHit>, String> {
        if !self.is_available() || store.vectors.is_empty() {
            return Ok(vec![]);
        }
        let vectors = self.embed(&[query.to_string()])?;
        let Some(query_vector) = vectors.into_iter().next() else {
            return Ok(vec![]);
        };
        Ok(store.search(&query_vector, top_k))
    }
}

/// Back-compat name used by hybrid search wiring.
pub type Embedder = RemoteIndexClient;

#[cfg(test)]
mod tests {
    use super::*;

    fn vector(values: &[f32]) -> Vec<f32> {
        values.to_vec()
    }

    #[test]
    fn cosine_search_ranks_the_closest_chunk() {
        let store = EmbeddingStore {
            enabled: true,
            model: "test".into(),
            vectors: vec![
                StoredVector {
                    file_path: "a.rs".into(),
                    start_line: 1,
                    end_line: 4,
                    text: "auth".into(),
                    vector: vector(&[1.0, 0.0]),
                },
                StoredVector {
                    file_path: "b.rs".into(),
                    start_line: 9,
                    end_line: 12,
                    text: "styles".into(),
                    vector: vector(&[0.0, 1.0]),
                },
            ],
        };
        let hits = store.search(&vector(&[0.9, 0.1]), 2);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].file, "a.rs");
    }

    #[test]
    fn upsert_replaces_same_range_and_retains_existing_files() {
        let mut store = EmbeddingStore::default();
        store.upsert(vec![StoredVector {
            file_path: "a.rs".into(),
            start_line: 1,
            end_line: 3,
            text: "one".into(),
            vector: vector(&[1.0]),
        }]);
        store.upsert(vec![StoredVector {
            file_path: "a.rs".into(),
            start_line: 1,
            end_line: 3,
            text: "two".into(),
            vector: vector(&[2.0]),
        }]);
        assert_eq!(store.len(), 1);
        assert_eq!(store.vectors[0].text, "two");

        let mut keep = std::collections::HashSet::new();
        keep.insert("b.rs".to_string());
        store.retain_files(&keep);
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn mismatched_vector_lengths_are_skipped() {
        let store = EmbeddingStore {
            enabled: true,
            model: "test".into(),
            vectors: vec![StoredVector {
                file_path: "a.rs".into(),
                start_line: 1,
                end_line: 2,
                text: "x".into(),
                vector: vector(&[1.0, 2.0, 3.0]),
            }],
        };
        assert!(store.search(&vector(&[1.0, 2.0]), 5).is_empty());
    }
}
