use std::collections::HashMap;
use std::sync::Arc;

pub(crate) fn remove_owned<T, O>(
    sessions: &mut HashMap<u32, T>,
    id: u32,
    owner: &Arc<O>,
    identity: impl FnOnce(&T) -> &Arc<O>,
) -> Option<T> {
    if sessions
        .get(&id)
        .is_some_and(|current| Arc::ptr_eq(identity(current), owner))
    {
        sessions.remove(&id)
    } else {
        None
    }
}

/// Why an owned terminal no longer has a live termination target. Ownership
/// loss is not one condition: a replaced registration, an already released
/// record and an unknown id need different diagnostics.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum OwnershipLoss {
    /// The registry holds a different native session for this id.
    Replaced,
    /// The registry released this session; its metadata is still present.
    Released,
    /// Neither the registry nor the metadata still knows this session.
    Unregistered,
}

/// `recorded_owner` is `Some(true)` when the metadata record for the id is the
/// owner we hold, `Some(false)` when a different record claimed the id, and
/// `None` when the id has no metadata at all.
pub(crate) fn ownership_loss(recorded_owner: Option<bool>) -> OwnershipLoss {
    match recorded_owner {
        Some(false) => OwnershipLoss::Replaced,
        Some(true) => OwnershipLoss::Released,
        None => OwnershipLoss::Unregistered,
    }
}

pub(crate) fn ownership_loss_note(loss: OwnershipLoss) -> &'static str {
    match loss {
        OwnershipLoss::Replaced => "a newer session owns this id",
        OwnershipLoss::Released => "its record was already released",
        OwnershipLoss::Unregistered => "it is no longer registered",
    }
}

/// One message for every terminal that could not be confirmed stopped. A single
/// failure keeps its original message so its specific guidance survives.
pub(crate) fn aggregate_cleanup_failures(mut failures: Vec<String>) -> Option<String> {
    match failures.len() {
        0 => None,
        1 => failures.pop(),
        count => Some(format!(
            "Could not confirm {count} terminals stopped: {}",
            failures.join("; ")
        )),
    }
}

pub(crate) fn reserve_id(next: &mut u64, requested: Option<u32>) -> Option<u32> {
    let id = requested.or_else(|| u32::try_from(*next).ok())?;
    *next = (*next).max(u64::from(id) + 1);
    Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_loss_notes_name_the_actual_condition() {
        assert_eq!(ownership_loss(Some(false)), OwnershipLoss::Replaced);
        assert_eq!(ownership_loss(Some(true)), OwnershipLoss::Released);
        assert_eq!(ownership_loss(None), OwnershipLoss::Unregistered);
        assert_eq!(
            ownership_loss_note(OwnershipLoss::Replaced),
            "a newer session owns this id"
        );
        assert_eq!(
            ownership_loss_note(OwnershipLoss::Released),
            "its record was already released"
        );
        assert_eq!(
            ownership_loss_note(OwnershipLoss::Unregistered),
            "it is no longer registered"
        );
    }

    #[test]
    fn cleanup_failures_keep_a_single_message_and_summarise_many() {
        assert_eq!(aggregate_cleanup_failures(Vec::new()), None);
        assert_eq!(
            aggregate_cleanup_failures(vec!["Retry Stop.".to_string()]),
            Some("Retry Stop.".to_string())
        );
        let many = aggregate_cleanup_failures(vec!["first".to_string(), "second".to_string()])
            .expect("many failures still report");
        assert!(many.starts_with("Could not confirm 2 terminals stopped"));
        assert!(many.contains("first"));
        assert!(many.contains("second"));
    }

    #[test]
    fn automatic_ids_exhaust_instead_of_reusing_the_last_value() {
        let mut next = u64::from(u32::MAX) - 1;
        assert_eq!(reserve_id(&mut next, None), Some(u32::MAX - 1));
        assert_eq!(reserve_id(&mut next, None), Some(u32::MAX));
        assert_eq!(reserve_id(&mut next, None), None);
        assert_eq!(reserve_id(&mut next, None), None);
    }

    #[test]
    fn requested_ids_never_rewind_the_automatic_counter() {
        let mut next = 1;
        assert_eq!(reserve_id(&mut next, Some(100)), Some(100));
        assert_eq!(reserve_id(&mut next, Some(42)), Some(42));
        assert_eq!(reserve_id(&mut next, None), Some(101));
        assert_eq!(reserve_id(&mut next, Some(u32::MAX)), Some(u32::MAX));
        assert_eq!(reserve_id(&mut next, None), None);
    }

    #[test]
    fn late_completion_preserves_a_distinct_owner_with_the_same_value() {
        let old = Arc::new("owner");
        let replacement = Arc::new("owner");
        let mut sessions = HashMap::from([(1, replacement.clone())]);
        assert!(remove_owned(&mut sessions, 1, &old, |current| current).is_none());
        assert!(Arc::ptr_eq(sessions.get(&1).unwrap(), &replacement));
    }

    #[test]
    fn confirmation_removes_only_the_matching_registration() {
        let owner = Arc::new(42);
        let other = Arc::new(42);
        let mut sessions = HashMap::from([(1, owner.clone()), (2, other.clone())]);
        assert!(remove_owned(&mut sessions, 1, &owner.clone(), |current| current).is_some());
        assert!(remove_owned(&mut sessions, 1, &owner, |current| current).is_none());
        assert!(Arc::ptr_eq(sessions.get(&2).unwrap(), &other));
    }

    #[test]
    fn removed_resources_can_be_dropped_after_releasing_the_registry_lock() {
        use std::sync::{Mutex, Weak};
        struct Session {
            owner: Arc<()>,
            registry: Weak<Mutex<HashMap<u32, Session>>>,
        }
        impl Drop for Session {
            fn drop(&mut self) {
                if let Some(registry) = self.registry.upgrade() {
                    assert!(
                        registry.try_lock().is_ok(),
                        "resource drop held the registry lock"
                    );
                }
            }
        }
        let owner = Arc::new(());
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        sessions.lock().unwrap().insert(
            1,
            Session {
                owner: owner.clone(),
                registry: Arc::downgrade(&sessions),
            },
        );
        let removed = {
            let mut locked = sessions.lock().unwrap();
            remove_owned(&mut locked, 1, &owner, |session| &session.owner)
        };
        assert!(removed.is_some());
        drop(removed);
        assert!(sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn native_record_identity_is_not_the_reused_session_id() {
        struct Session {
            metadata: Arc<()>,
            handle: u32,
        }
        let old = Arc::new(());
        let replacement = Arc::new(());
        let mut sessions = HashMap::from([(
            7,
            Session {
                metadata: replacement.clone(),
                handle: 10,
            },
        )]);
        assert!(remove_owned(&mut sessions, 7, &old, |session| &session.metadata).is_none());
        assert_eq!(sessions.get(&7).unwrap().handle, 10);
        assert!(remove_owned(&mut sessions, 7, &replacement, |session| {
            &session.metadata
        })
        .is_some());
    }
}
