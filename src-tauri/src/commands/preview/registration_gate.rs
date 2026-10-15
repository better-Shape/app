//! Arbitration between a native script replacement and its caller's deadline.
use std::sync::atomic::{AtomicU8, Ordering};

const PENDING: u8 = 0;
const COMMITTING: u8 = 1;
const CANCELLED: u8 = 2;

#[derive(Default)]
pub(crate) struct RegistrationGate(AtomicU8);

impl RegistrationGate {
    /// Claim the irreversible replacement. Only one callback may commit.
    pub(crate) fn try_commit(&self) -> bool {
        self.0
            .compare_exchange(PENDING, COMMITTING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// True means no replacement may start; false means it already owns completion.
    pub(crate) fn cancel_before_commit(&self) -> bool {
        match self
            .0
            .compare_exchange(PENDING, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
        {
            Ok(_) | Err(CANCELLED) => true,
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn cancellation_prevents_late_commit() {
        let gate = RegistrationGate::default();
        assert!(gate.cancel_before_commit());
        assert!(!gate.try_commit());
        assert!(gate.cancel_before_commit());
    }

    #[test]
    fn claimed_commit_cannot_be_timed_out_or_claimed_twice() {
        let gate = RegistrationGate::default();
        assert!(gate.try_commit());
        assert!(!gate.cancel_before_commit());
        assert!(!gate.try_commit());
    }

    #[test]
    fn competing_deadline_and_callback_have_exactly_one_winner() {
        for _ in 0..100 {
            let gate = Arc::new(RegistrationGate::default());
            let barrier = Arc::new(Barrier::new(2));
            let callback_gate = Arc::clone(&gate);
            let callback_barrier = Arc::clone(&barrier);
            let callback = std::thread::spawn(move || {
                callback_barrier.wait();
                callback_gate.try_commit()
            });
            barrier.wait();
            let cancelled = gate.cancel_before_commit();
            assert_ne!(cancelled, callback.join().unwrap());
        }
    }
}
