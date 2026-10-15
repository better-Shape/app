use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static NEXT_TURN: AtomicU64 = AtomicU64::new(1);

pub fn next_turn_sequence() -> Option<u64> {
    advance(&NEXT_TURN)
}

fn advance(counter: &AtomicU64) -> Option<u64> {
    counter
        .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
        .ok()
}

/// One cancellation watermark per originating WebView/conversation lane, not
/// one tombstone per send. Request ids end in a monotonically increasing u64.
#[derive(Default)]
pub struct RequestCancellations(HashMap<String, u64>);

impl RequestCancellations {
    fn parse(id: &str) -> Option<(&str, u64)> {
        if id.len() > 4096 {
            return None;
        }
        let (scope, sequence) = id.rsplit_once(':')?;
        if scope.is_empty() {
            return None;
        }
        Some((scope, sequence.parse::<u64>().ok()?))
    }

    pub fn cancel(&mut self, id: &str) -> bool {
        let Some((scope, sequence)) = Self::parse(id) else {
            return false;
        };
        let watermark = self.0.entry(scope.to_string()).or_default();
        *watermark = (*watermark).max(sequence);
        true
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        Self::parse(id).is_some_and(|(scope, sequence)| {
            self.0.get(scope).is_some_and(|last| sequence <= *last)
        })
    }
}

/// Pins Stop cleanup after the run drops its active slot. No mutex guard is
/// held across async cleanup, but replacement admission remains blocked.
pub struct StopGuard<'a> {
    stopping: &'a Mutex<HashSet<String>>,
    conversation_id: String,
}

impl Drop for StopGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut stopping) = self.stopping.lock() {
            stopping.remove(&self.conversation_id);
        }
    }
}

pub fn admit<T>(
    active: &Mutex<HashMap<String, T>>,
    stopping: &Mutex<HashSet<String>>,
    conversation_id: String,
    make: impl FnOnce() -> Option<(String, T)>,
) -> Option<String> {
    let stopping = stopping.lock().ok()?;
    if stopping.contains(&conversation_id) {
        return None;
    }
    let mut active = active.lock().ok()?;
    if active.contains_key(&conversation_id) {
        return None;
    }
    let (id, record) = make()?;
    active.insert(conversation_id, record);
    Some(id)
}

pub fn begin_stop<'a, T>(
    active: &Mutex<HashMap<String, T>>,
    stopping: &'a Mutex<HashSet<String>>,
    conversation_id: &str,
    matches: impl FnOnce(&T) -> bool,
) -> Option<StopGuard<'a>> {
    let mut stopped = stopping.lock().ok()?;
    if stopped.contains(conversation_id) {
        return None;
    }
    let active = active.lock().ok()?;
    if !matches(active.get(conversation_id)?) {
        return None;
    }
    stopped.insert(conversation_id.to_string());
    Some(StopGuard {
        stopping,
        conversation_id: conversation_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_precedes_admission_without_cancelling_other_lanes_or_newer_sends() {
        let mut state = RequestCancellations::default();
        assert!(state.cancel("window:chat-a:2"));
        assert!(state.is_cancelled("window:chat-a:1"));
        assert!(state.is_cancelled("window:chat-a:2"));
        assert!(!state.is_cancelled("window:chat-a:3"));
        assert!(!state.is_cancelled("window:chat-b:1"));
        assert!(!state.is_cancelled("other:chat-a:1"));
        state.cancel("window:chat-a:1");
        assert!(state.is_cancelled("window:chat-a:2"));
        for n in 3..10000 {
            state.cancel(&format!("window:chat-a:{n}"));
        }
        assert_eq!(state.0.len(), 1);
    }

    #[test]
    fn sequences_do_not_wrap_and_invalid_requests_do_not_reserve_state() {
        let counter = AtomicU64::new(u64::MAX - 1);
        assert_eq!(advance(&counter), Some(u64::MAX - 1));
        assert_eq!(advance(&counter), None);
        let mut state = RequestCancellations::default();
        for id in ["legacy", ":1", "a:b:no", "a:b:18446744073709551616"] {
            assert!(!state.cancel(id));
            assert!(!state.is_cancelled(id));
        }
        assert!(state.0.is_empty());
        let first = next_turn_sequence().unwrap();
        assert!(next_turn_sequence().unwrap() > first);
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    #[test]
    fn stop_owns_cleanup_after_run_finishes_and_rejects_an_obsolete_request() {
        let active = Mutex::new(HashMap::new());
        let stopping = Mutex::new(HashSet::new());
        assert_eq!(
            admit(&active, &stopping, "a".into(), || Some((
                "1:opaque".into(),
                "request-a"
            ))),
            Some("1:opaque".into())
        );
        let guard = begin_stop(&active, &stopping, "a", |request| *request == "request-a").unwrap();
        active.lock().unwrap().remove("a");
        assert!(admit(&active, &stopping, "a".into(), || panic!(
            "must not allocate before admission"
        ))
        .is_none());
        drop(guard);
        assert!(admit(&active, &stopping, "a".into(), || Some((
            "2:opaque".into(),
            "request-b"
        )))
        .is_some());
        assert!(begin_stop(&active, &stopping, "a", |request| *request == "request-a").is_none());
        assert!(stopping.lock().unwrap().is_empty());
    }
    #[test]
    fn admission_does_not_allocate_an_ordinal_for_a_rejected_contender() {
        let active = Mutex::new(HashMap::from([("a".to_string(), ())]));
        let stopping = Mutex::new(HashSet::new());
        assert!(admit(&active, &stopping, "a".into(), || panic!(
            "rejected admission"
        ))
        .is_none());
        assert!(admit(&active, &stopping, "b".into(), || Some((
            "2:opaque".into(),
            ()
        )))
        .is_some());
    }
}
