use std::io;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

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

#[cfg(test)]
mod tests {
    use super::*;

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
