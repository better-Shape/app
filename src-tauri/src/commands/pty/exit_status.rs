use std::io;
use std::sync::{Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

// Output EOF can precede process exit. Poll without holding the child lock
// between attempts so a concurrent Stop can still acquire it and kill the child.
pub(crate) fn wait_for_exit<T>(
    child: &Mutex<T>,
    mut poll: impl FnMut(&mut T) -> io::Result<Option<i32>>,
) -> io::Result<i32> {
    loop {
        let status = {
            let mut child = child
                .lock()
                .map_err(|_| io::Error::other("PTY child lock poisoned"))?;
            poll(&mut child)?
        };
        if let Some(code) = status {
            return Ok(code);
        }
        thread::sleep(Duration::from_millis(100));
    }
}

// A successful kill request is not proof of exit. Keep the handle in its owner
// until polling confirms termination; never hold its lock between attempts.
pub(crate) fn terminate<T>(
    child: &Mutex<T>,
    mut poll: impl FnMut(&mut T) -> io::Result<Option<i32>>,
    mut kill: impl FnMut(&mut T) -> io::Result<()>,
    timeout: Duration,
) -> io::Result<i32> {
    let started = Instant::now();
    let mut signalled = false;
    loop {
        match child.try_lock() {
            Ok(mut child) => {
                if let Some(code) = poll(&mut child)? {
                    return Ok(code);
                }
                if !signalled {
                    if let Err(error) = kill(&mut child) {
                        // The process can exit between the first poll and kill.
                        return match poll(&mut child) {
                            Ok(Some(code)) => Ok(code),
                            _ => Err(error),
                        };
                    }
                    signalled = true;
                    if let Some(code) = poll(&mut child)? {
                        return Ok(code);
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
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Could not confirm terminal process exit; its handle is retained for retry",
            ));
        }
        thread::sleep(remaining.min(Duration::from_millis(25)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            7
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
        assert_eq!(result.unwrap(), -1);
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
            -1
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
            9
        );
    }

    #[test]
    fn an_accepted_kill_without_exit_times_out_without_taking_the_child() {
        let child = Mutex::new(42);
        let error = terminate(&child, |_| Ok(None), |_| Ok(()), Duration::ZERO).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
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
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
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
        assert_eq!(result.unwrap(), 0);
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
        assert_ne!(result.unwrap(), 0);
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
