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

/// Reserve every lane a teardown is about to touch, so no Stop can claim one of
/// them while it runs. Observing the lanes first and killing afterwards leaves a
/// window in which a Stop claims the lane and starts its own teardown over the
/// same session registry; claiming is atomic per lane and the guards keep
/// replacement admission blocked until the caller drops them. `None` means at
/// least one lane is already owned by someone else - nothing is claimed then, so
/// the caller keeps its sessions and can retry.
pub fn claim_lanes<'a, 'b>(
    stopping: &'a Mutex<HashSet<String>>,
    lanes: impl IntoIterator<Item = &'b str>,
) -> Option<Vec<StopGuard<'a>>> {
    let mut guards = Vec::new();
    for lane in lanes {
        guards.push(begin_exclusive_cleanup(stopping, lane)?);
    }
    Some(guards)
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

pub fn begin_exclusive_cleanup<'a>(
    stopping: &'a Mutex<HashSet<String>>,
    conversation_id: &str,
) -> Option<StopGuard<'a>> {
    let mut stopped = stopping.lock().ok()?;
    if !stopped.insert(conversation_id.to_string()) {
        return None;
    }
    Some(StopGuard {
        stopping,
        conversation_id: conversation_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retried_cleanup_is_refused_only_for_a_lane_that_is_still_stopping() {
        let stopping = Mutex::new(HashSet::from(["busy".to_string()]));
        // The stopping lane is refused, and the refusal claims nothing else.
        assert!(claim_lanes(&stopping, ["busy"]).is_none());
        // An unrelated lane and no lanes at all let the retry through.
        assert_eq!(claim_lanes(&stopping, ["idle"]).unwrap().len(), 1);
        assert!(claim_lanes(&stopping, std::iter::empty())
            .unwrap()
            .is_empty());
        assert!(!stopping.lock().unwrap().contains("idle"));
        // Once the Stop guard drops, the lane can be claimed again.
        stopping.lock().unwrap().remove("busy");
        assert!(claim_lanes(&stopping, ["busy"]).is_some());
    }

    #[test]
    fn a_claimed_lane_cannot_be_claimed_by_a_stop_or_a_second_retry() {
        let active = Mutex::new(HashMap::from([("a".to_string(), "request-a".to_string())]));
        let stopping = Mutex::new(HashSet::new());
        let retry = claim_lanes(&stopping, ["a"]).unwrap();
        // A Stop racing this retry fails to claim instead of tearing the lane
        // down underneath it, and neither does another retry.
        assert!(begin_stop(&active, &stopping, "a", |request| *request == "request-a").is_none());
        assert!(claim_lanes(&stopping, ["a"]).is_none());
        // A lane that is only claimed exclusively is still not admitting turns.
        assert!(admit(&active, &stopping, "a".into(), || Some((
            "blocked".into(),
            "request-b".to_string()
        )))
        .is_none());
        drop(retry);
        assert!(begin_stop(&active, &stopping, "a", |request| *request == "request-a").is_some());
    }

    #[test]
    fn exclusive_cleanup_blocks_idle_admission_until_its_owner_drops() {
        let active = Mutex::new(HashMap::<String, ()>::new());
        let stopping = Mutex::new(HashSet::new());
        let owner = begin_exclusive_cleanup(&stopping, "a").unwrap();
        assert!(begin_exclusive_cleanup(&stopping, "a").is_none());
        assert!(admit(&active, &stopping, "a".into(), || Some((
            "blocked".into(),
            ()
        )))
        .is_none());
        assert!(admit(&active, &stopping, "b".into(), || Some((
            "other".into(),
            ()
        )))
        .is_some());
        drop(owner);
        assert!(admit(&active, &stopping, "a".into(), || Some((
            "ready".into(),
            ()
        )))
        .is_some());
    }

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
