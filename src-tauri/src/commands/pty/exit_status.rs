use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

/// Consecutive transient poll failures `wait_for_exit` tolerates before it gives up. A status
/// poll can fail for a reason that says nothing about the process - a signal that interrupted the
/// wait, a handle that is busy - and treating that as the end of the wait would leave a session
/// that has already reached output EOF looking like it is still running. A handle that never
/// becomes pollable again still has to end the wait, so the tolerance is bounded.
const TRANSIENT_POLL_LIMIT: usize = 20;

/// Whether a failed status poll says nothing about the process itself.
fn transient(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
    )
}

/// Poll once, treating a transient failure as "not exited yet". Anything else is returned: an
/// unreadable status must not be reported as a confirmed exit.
fn poll_exited<T>(
    poll: &mut impl FnMut(&mut T) -> io::Result<Option<i32>>,
    child: &mut T,
) -> io::Result<Option<i32>> {
    match poll(child) {
        Ok(status) => Ok(status),
        Err(error) if transient(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

// Output EOF can precede process exit. Poll without holding the child lock
// between attempts so a concurrent Stop can still acquire it and kill the child.
pub(crate) fn wait_for_exit<T>(
    child: &Mutex<T>,
    mut poll: impl FnMut(&mut T) -> io::Result<Option<i32>>,
) -> io::Result<i32> {
    let mut failures = 0usize;
    loop {
        let status = {
            let mut child = child
                .lock()
                .map_err(|_| io::Error::other("PTY child lock poisoned"))?;
            match poll(&mut child) {
                Ok(status) => {
                    failures = 0;
                    status
                }
                Err(error) if transient(&error) => {
                    failures += 1;
                    if failures >= TRANSIENT_POLL_LIMIT {
                        return Err(error);
                    }
                    None
                }
                Err(error) => return Err(error),
            }
        };
        if let Some(code) = status {
            return Ok(code);
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/// Wait, up to `timeout`, for the pipe readers of a finished process to drain.
///
/// Seeing the child exit is not the same as having its output: the bytes it wrote
/// just before exiting are still in the pipe, owned by the reader threads. A waiter
/// that wakes on the exit signal alone can therefore return a command's output
/// without its last lines. Waiting here before reporting the exit closes that gap.
/// The wait is bounded because a descendant that inherited the pipe can hold it
/// open long after the process this session tracks has gone: reporting the exit
/// late is a smaller problem than never reporting it at all.
pub(crate) fn await_drains(pending: &AtomicUsize, timeout: Duration) {
    let started = Instant::now();
    while pending.load(Ordering::SeqCst) > 0 {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return;
        }
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
}

/// What a completed termination observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Terminated {
    /// The status the poll reported, or -1 when the platform has no code for it (a signalled
    /// child). Meaningful for callers only together with `killed`.
    pub code: i32,
    /// Whether this call had to kill the process. A process that had already exited when the
    /// stop arrived was not killed, so its own status is the truthful one to report.
    pub killed: bool,
}

// A successful kill request is not proof of exit. Keep the handle in its owner
// until polling confirms termination; never hold its lock between attempts.
pub(crate) fn terminate<T>(
    child: &Mutex<T>,
    mut poll: impl FnMut(&mut T) -> io::Result<Option<i32>>,
    mut kill: impl FnMut(&mut T) -> io::Result<()>,
    timeout: Duration,
) -> io::Result<Terminated> {
    let started = Instant::now();
    let mut acquired = false;
    let mut signalled = false;
    loop {
        match child.try_lock() {
            Ok(mut child) => {
                acquired = true;
                if let Some(code) = poll_exited(&mut poll, &mut child)? {
                    return Ok(Terminated {
                        code,
                        killed: signalled,
                    });
                }
                if !signalled {
                    if let Err(error) = kill(&mut child) {
                        // The process can exit between the first poll and kill. A kill that
                        // failed did not stop anything, so the reported status is its own.
                        return match poll_exited(&mut poll, &mut child) {
                            Ok(Some(code)) => Ok(Terminated {
                                code,
                                killed: false,
                            }),
                            Ok(None) => Err(error),
                            Err(poll_error) => Err(poll_error),
                        };
                    }
                    signalled = true;
                    if let Some(code) = poll_exited(&mut poll, &mut child)? {
                        return Ok(Terminated { code, killed: true });
                    }
                }
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err(io::Error::other("Terminal child lock poisoned"));
            }
            Err(TryLockError::WouldBlock) => {}
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            // Contention and a survived kill are fixed differently: a busy
            // child needs another attempt, a surviving process needs Stop.
            return Err(if acquired {
                io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Terminal process did not exit after termination; its handle is retained for retry",
                )
            } else {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "Terminal child was busy in another operation; its handle is retained for retry",
                )
            });
        }
        thread::sleep(remaining.min(Duration::from_millis(25)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_transient_status_failure_does_not_end_the_waiter() {
        let mut calls = 0;
        let code = wait_for_exit(&Mutex::new(()), |_| {
            calls += 1;
            match calls {
                1 => Err(io::Error::new(io::ErrorKind::Interrupted, "interrupted")),
                2 => Err(io::Error::new(io::ErrorKind::WouldBlock, "busy")),
                _ => Ok(Some(3)),
            }
        })
        .unwrap();
        assert_eq!(code, 3);
    }

    #[test]
    fn a_status_poll_that_never_recovers_still_reports_the_failure() {
        let error = wait_for_exit(&Mutex::new(()), |_| {
            Err(io::Error::new(io::ErrorKind::InvalidInput, "handle gone"))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn a_drain_in_progress_is_waited_for_before_the_exit_is_reported() {
        let pending = AtomicUsize::new(1);
        let order = Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            scope.spawn(|| {
                await_drains(&pending, Duration::from_secs(5));
                order.lock().unwrap().push("reported");
            });
            thread::sleep(Duration::from_millis(20));
            order.lock().unwrap().push("drained");
            pending.store(0, Ordering::SeqCst);
        });
        // The reader finishing is what releases the exit, so it must come first.
        assert_eq!(*order.lock().unwrap(), vec!["drained", "reported"]);
    }

    #[test]
    fn a_drain_that_never_finishes_does_not_hold_the_exit_forever() {
        let pending = AtomicUsize::new(1);
        let started = Instant::now();
        await_drains(&pending, Duration::from_millis(30));
        assert!(started.elapsed() >= Duration::from_millis(25));
        assert!(started.elapsed() < Duration::from_secs(5));
        // Nothing to wait for returns immediately.
        pending.store(0, Ordering::SeqCst);
        let started = Instant::now();
        await_drains(&pending, Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_millis(25));
    }

    #[test]
    fn a_transient_failure_that_never_clears_still_ends_the_wait() {
        let mut attempts = 0;
        let error = wait_for_exit(&Mutex::new(()), |_| {
            attempts += 1;
            Err(io::Error::new(io::ErrorKind::Interrupted, "interrupted"))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(attempts, TRANSIENT_POLL_LIMIT);
    }

    #[test]
    fn termination_is_not_abandoned_by_a_transient_status_failure() {
        let child = Mutex::new(false);
        let mut polls = 0;
        let mut kills = 0;
        let observed = terminate(
            &child,
            |killed| {
                polls += 1;
                match polls {
                    // A failure that says nothing about the process must not turn a
                    // stop into an error the user has to retry.
                    1 => Err(io::Error::new(io::ErrorKind::Interrupted, "interrupted")),
                    _ => Ok(killed.then_some(-1)),
                }
            },
            |killed| {
                kills += 1;
                *killed = true;
                Ok(())
            },
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(
            observed,
            Terminated {
                code: -1,
                killed: true
            }
        );
        assert_eq!(kills, 1);
    }

    #[test]
    fn termination_preserves_an_already_exited_status_without_killing() {
        let child = Mutex::new(Some(7));
        assert_eq!(
            terminate(
                &child,
                |code| Ok(*code),
                |_| panic!("must not kill"),
                Duration::ZERO
            )
            .unwrap(),
            Terminated {
                code: 7,
                killed: false
            }
        );
        assert_eq!(*child.lock().unwrap(), Some(7));
    }

    #[test]
    fn termination_requires_confirmed_exit_after_kill() {
        let child = Mutex::new(false);
        let mut kills = 0;
        let result = terminate(
            &child,
            |killed| Ok(killed.then_some(-1)),
            |killed| {
                kills += 1;
                *killed = true;
                Ok(())
            },
            Duration::ZERO,
        );
        // The process only exited because this call killed it, so the stop owns the
        // reported status.
        assert_eq!(
            result.unwrap(),
            Terminated {
                code: -1,
                killed: true
            }
        );
        assert_eq!(kills, 1);
    }

    #[test]
    fn a_failed_kill_keeps_the_same_child_available_for_retry() {
        let child = Mutex::new(false);
        let error = terminate(
            &child,
            |exited| Ok(exited.then_some(-1)),
            |_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied")),
            Duration::ZERO,
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!*child.lock().unwrap());
        assert_eq!(
            terminate(
                &child,
                |exited| Ok(exited.then_some(-1)),
                |exited| {
                    *exited = true;
                    Ok(())
                },
                Duration::ZERO
            )
            .unwrap(),
            Terminated {
                code: -1,
                killed: true
            }
        );
    }

    #[test]
    fn an_exit_racing_a_failed_kill_is_confirmed() {
        let child = Mutex::new(None);
        assert_eq!(
            terminate(
                &child,
                |code| Ok(*code),
                |code| {
                    *code = Some(9);
                    Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "already exited",
                    ))
                },
                Duration::ZERO
            )
            .unwrap(),
            // The kill did not take effect, so the status is the process's own.
            Terminated {
                code: 9,
                killed: false
            }
        );
    }

    #[test]
    fn an_accepted_kill_without_exit_times_out_without_taking_the_child() {
        let child = Mutex::new(42);
        let error = terminate(&child, |_| Ok(None), |_| Ok(()), Duration::ZERO).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(
            error.to_string().contains("did not exit"),
            "a survived kill must be reported as such: {error}"
        );
        assert_eq!(*child.lock().unwrap(), 42);
    }

    #[test]
    fn a_busy_child_lock_has_a_bounded_wait() {
        let child = Mutex::new(());
        let _guard = child.lock().unwrap();
        let error = terminate(
            &child,
            |_| panic!("must not poll"),
            |_| panic!("must not kill"),
            Duration::ZERO,
        )
        .unwrap_err();
        // Contention is not a failed termination: callers retry the operation
        // instead of telling the user the process refused to stop.
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        assert!(
            error.to_string().contains("busy"),
            "lock contention must be reported as such: {error}"
        );
    }

    #[test]
    fn termination_rejects_poison_without_losing_the_child() {
        let child = Mutex::new(42);
        let _ = std::panic::catch_unwind(|| {
            let _guard = child.lock().unwrap();
            panic!("poison fixture");
        });
        assert!(terminate(
            &child,
            |_| panic!("must not poll"),
            |_| panic!("must not kill"),
            Duration::ZERO
        )
        .is_err());
        assert_eq!(**child.lock().unwrap_err().get_ref(), 42);
    }

    #[test]
    fn poll_failure_after_kill_does_not_confirm_exit() {
        let child = Mutex::new(false);
        let error = terminate(
            &child,
            |killed| {
                if *killed {
                    Err(io::Error::other("poll failed"))
                } else {
                    Ok(None)
                }
            },
            |killed| {
                *killed = true;
                Ok(())
            },
            Duration::ZERO,
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "poll failed");
        assert!(*child.lock().unwrap());
    }

    #[test]
    fn exit_polling_releases_the_lock_and_signals_only_once() {
        let child = Mutex::new(0);
        let mut kills = 0;
        let result = terminate(
            &child,
            |polls| {
                *polls += 1;
                Ok((*polls == 3).then_some(0))
            },
            |_| {
                kills += 1;
                Ok(())
            },
            Duration::from_secs(1),
        );
        assert_eq!(
            result.unwrap(),
            Terminated {
                code: 0,
                killed: true
            }
        );
        assert_eq!(kills, 1);
        assert!(child.try_lock().is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn termination_kills_and_reaps_a_real_process_without_consuming_its_handle() {
        let (child, stdin) = child_with_closed_output();
        let child = Mutex::new(child);
        let result = terminate(
            &child,
            |child| {
                child
                    .try_wait()
                    .map(|status| status.map(|s| s.code().unwrap_or(-1)))
            },
            |child| child.kill(),
            Duration::from_secs(2),
        );
        drop(stdin);
        if result.is_err() {
            let _ = child.lock().unwrap().kill();
            let _ = child.lock().unwrap().wait();
        }
        let observed = result.unwrap();
        assert_ne!(observed.code, 0);
        assert!(observed.killed);
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
    }

    #[test]
    fn waits_for_a_real_status_after_pending_observations() {
        for expected in [0, 7, -1] {
            let child = Mutex::new(0);
            let result = wait_for_exit(&child, |attempts| {
                *attempts += 1;
                Ok((*attempts == 2).then_some(expected))
            });
            assert_eq!(result.unwrap(), expected);
            assert_eq!(*child.lock().unwrap(), 2);
        }
    }

    #[test]
    fn returns_poll_errors_without_inventing_success() {
        let result = wait_for_exit(&Mutex::new(()), |_| {
            Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid child"))
        });
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn poisoned_lock_is_an_error_without_polling() {
        let child = Mutex::new(());
        let _ = std::panic::catch_unwind(|| {
            let _guard = child.lock().unwrap();
            panic!("poison fixture");
        });
        assert!(wait_for_exit(&child, |_| panic!("must not poll")).is_err());
    }

    #[cfg(unix)]
    fn child_with_closed_output() -> (std::process::Child, std::process::ChildStdin) {
        use std::io::Read;
        use std::process::{Command, Stdio};
        let mut child = Command::new("sh")
            .args([
                "-c",
                "printf final-output; exec 1>&- 2>&-; read line; exit 7",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut output = String::new();
        child
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut output)
            .unwrap();
        assert_eq!(output, "final-output");
        assert!(child.try_wait().unwrap().is_none());
        (child, stdin)
    }

    #[test]
    #[cfg(unix)]
    fn eof_does_not_replace_a_later_nonzero_exit() {
        use std::io::Write;
        use std::sync::{mpsc, Arc};
        let (child, mut stdin) = child_with_closed_output();
        let child = Arc::new(Mutex::new(child));
        let observing = child.clone();
        let (ready, observed) = mpsc::channel();
        let waiter = thread::spawn(move || {
            wait_for_exit(&observing, |child| {
                let status = child.try_wait()?.map(|status| status.code().unwrap_or(-1));
                let _ = ready.send(());
                Ok(status)
            })
        });
        let started = observed.recv_timeout(Duration::from_secs(2));
        let _ = stdin.write_all(b"finish\n");
        drop(stdin);
        let result = waiter.join().unwrap().unwrap();
        started.unwrap();
        assert_eq!(result, 7);
        assert_eq!(
            child.lock().unwrap().try_wait().unwrap().unwrap().code(),
            Some(7)
        );
    }

    #[test]
    #[cfg(unix)]
    fn concurrent_kill_acquires_the_child_and_waiter_reaps_it() {
        use std::sync::{mpsc, Arc};
        let (child, stdin) = child_with_closed_output();
        let child = Arc::new(Mutex::new(child));
        let observing = child.clone();
        let (ready, observed) = mpsc::channel();
        let waiter = thread::spawn(move || {
            wait_for_exit(&observing, |child| {
                let status = child.try_wait()?.map(|status| status.code().unwrap_or(-1));
                let _ = ready.send(());
                Ok(status)
            })
        });
        let started = observed.recv_timeout(Duration::from_secs(2));
        let killing = child.clone();
        let (killed, received) = mpsc::channel();
        let killer = thread::spawn(move || {
            let result = killing.lock().unwrap().kill();
            killed.send(result).unwrap();
        });
        let result = received.recv_timeout(Duration::from_secs(2));
        // Closing stdin also releases the fixture if a broken waiter prevents kill.
        drop(stdin);
        killer.join().unwrap();
        let exit = waiter.join().unwrap().unwrap();
        started.unwrap();
        result.unwrap().unwrap();
        assert_ne!(exit, 0);
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
    }
}
