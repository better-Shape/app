use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex};

use crate::core::error::AppError;

use super::registration_gate::RegistrationGate;

// Every caller targets the single "main" webview below, regardless of its own
// window. Serialize replacements on that controller through acknowledgement.
// A per-calling-window lock would allow conflicting writes to the same target.
static REGISTRATION: Mutex<()> = Mutex::const_new(());
type Completion = oneshot::Sender<Result<(), String>>;

struct CancelPending(Arc<RegistrationGate>);
impl Drop for CancelPending {
    fn drop(&mut self) {
        self.0.cancel_before_commit();
    }
}

fn finish_registration(send: Completion, result: Result<(), String>) {
    if send.send(result).is_err() {
        // Never remove a committed replacement just because its caller left:
        // the previous script may already be gone. Pending callbacks cancel
        // before replacement and remove only their newly added script instead.
        log::debug!(target: "design", "Design bridge caller disconnected before acknowledgement");
    }
}

fn wrap_iframe_only(script: &str) -> String {
    format!(
        r#"/* bettershape-design-bridge */
(function(){{
try {{
  if (window.top === window) return;
  var loc = location || {{}};
  var h = String(loc.hostname || "");
  var port = String(loc.port || "");
  if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1") return;
  // Never inject into the BetterShape IDE itself (nested / HMR iframes on 48921).
  if (port === "48921" || port === "1420") return;
  var path = String(loc.pathname || "");
  if (path.indexOf("/_next") === 0 || path.indexOf("/onboarding") === 0) return;
}} catch (e) {{ return; }}
function boot() {{{script}
}}
// DocumentCreated is too early: wrapping fetch/history and appending overlay
// nodes before React hydrates leaves Next/Vite previews as a white canvas.
if (document.readyState === "complete") {{
  setTimeout(boot, 0);
}} else {{
  window.addEventListener("load", function () {{ setTimeout(boot, 0); }});
}}
}})();"#
    )
}

/// Register the guarded bridge in future iframe documents; acknowledge native installation.
#[tauri::command]
pub async fn register_design_bridge(app: AppHandle, script: String) -> Result<(), AppError> {
    let _registration = REGISTRATION.lock().await;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Message("The main webview is unavailable.".into()))?;
    let wrapped = wrap_iframe_only(&script);
    let (send, receive) = oneshot::channel();
    let gate = Arc::new(RegistrationGate::default());
    let callback_gate = Arc::clone(&gate);
    win.with_webview(move |webview| {
        if send.is_closed() {
            return;
        }
        #[cfg(windows)]
        install_on_windows(&webview, &wrapped, send, callback_gate);
        #[cfg(target_os = "macos")]
        if callback_gate.try_commit() {
            finish_registration(send, install_on_macos(&webview, &wrapped));
        }
        #[cfg(target_os = "linux")]
        if callback_gate.try_commit() {
            finish_registration(send, install_on_linux(&webview, &wrapped));
        }
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        {
            let _ = (webview, wrapped, callback_gate);
            finish_registration(
                send,
                Err("Design inspection is unavailable on this platform.".into()),
            );
        }
    })
    .map_err(|error| {
        gate.cancel_before_commit();
        AppError::Message(error.to_string())
    })?;
    await_registration(receive, gate, std::time::Duration::from_secs(10)).await
}

async fn await_registration(
    mut receive: oneshot::Receiver<Result<(), String>>,
    gate: Arc<RegistrationGate>,
    timeout: std::time::Duration,
) -> Result<(), AppError> {
    let _cancel_on_drop = CancelPending(Arc::clone(&gate));
    let completion = match tokio::time::timeout(timeout, &mut receive).await {
        Ok(result) => result,
        Err(_) if gate.cancel_before_commit() => {
            return Err(AppError::Message(
                "Timed out installing the design bridge.".into(),
            ));
        }
        // Once the native callback claims the synchronous replacement, it owns
        // the result. Do not report a timeout and then undo its acknowledged work.
        Err(_) => receive.await,
    };
    match completion {
        Ok(result) => result.map_err(AppError::Message),
        Err(_) => Err(AppError::Message(
            "The webview closed before installing the design bridge.".into(),
        )),
    }
}

/// Print design-mode diagnostics to the BetterShape log target only — never the project PTY.
#[tauri::command]
pub fn design_mode_log(level: String, message: String) {
    match level.to_ascii_uppercase().as_str() {
        "ERROR" => log::error!(target: "design", "{message}"),
        "WARN" => log::warn!(target: "design", "{message}"),
        "INFO" => log::info!(target: "design", "{message}"),
        "DEBUG" => log::debug!(target: "design", "{message}"),
        _ => log::info!(target: "design", "{message}"),
    }
}

#[cfg(windows)]
fn install_on_windows(
    webview: &tauri::webview::PlatformWebview,
    script: &str,
    send: Completion,
    gate: Arc<RegistrationGate>,
) {
    use std::{cell::RefCell, rc::Rc, sync::Mutex};
    use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
    use windows_core::HSTRING;

    static SCRIPT_ID: Mutex<Option<String>> = Mutex::new(None);
    let completion = Rc::new(RefCell::new(Some(send)));
    let callback_completion = Rc::clone(&completion);
    // Tauri runs this closure on the owning WebView2 UI thread. COM handles do
    // not leave that thread; only the Send-capable completion crosses back.
    let result = unsafe {
        (|| {
            let core = webview
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let callback_core = core.clone();
            let handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                move |hr, id| {
                    let Some(send) = callback_completion.borrow_mut().take() else {
                        return Ok(());
                    };
                    let new_id = id.to_string();
                    if !hr.is_ok() || new_id.is_empty() {
                        finish_registration(
                            send,
                            Err(format!("WebView2 rejected the design bridge: {hr:?}")),
                        );
                        return Ok(());
                    }
                    if !gate.try_commit() {
                        let _ = callback_core.RemoveScriptToExecuteOnDocumentCreated(
                            &HSTRING::from(new_id.as_str()),
                        );
                        return Ok(());
                    }
                    let previous = SCRIPT_ID
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .clone();
                    if let Some(previous) = previous {
                        if let Err(error) = callback_core
                            .RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(previous))
                        {
                            let _ = callback_core.RemoveScriptToExecuteOnDocumentCreated(
                                &HSTRING::from(new_id.as_str()),
                            );
                            finish_registration(
                                send,
                                Err(format!("Could not replace the design bridge: {error}")),
                            );
                            return Ok(());
                        }
                    }
                    *SCRIPT_ID.lock().unwrap_or_else(|error| error.into_inner()) = Some(new_id);
                    finish_registration(send, Ok(()));
                    Ok(())
                },
            ));
            core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &handler)
                .map_err(|error| error.to_string())
        })()
    };
    if let Err(error) = result {
        if let Some(send) = completion.borrow_mut().take() {
            finish_registration(send, Err(error));
        }
    }
}

#[cfg(target_os = "macos")]
fn install_on_macos(webview: &tauri::webview::PlatformWebview, script: &str) -> Result<(), String> {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_foundation::NSString;
    use objc2_web_kit::{WKUserContentController, WKUserScript, WKUserScriptInjectionTime};

    let main =
        MainThreadMarker::new().ok_or("Design bridge installation requires the main thread.")?;
    // Tauri's controller pointer is a live WKUserContentController for this
    // with_webview callback. Keep it borrowed only for the callback's lifetime.
    unsafe {
        let controller = (webview.controller() as *const WKUserContentController)
            .as_ref()
            .ok_or("The WebKit user-content controller is unavailable.")?;
        let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
            WKUserScript::alloc(main),
            &NSString::from_str(script),
            WKUserScriptInjectionTime::AtDocumentStart,
            false,
        );
        let existing = controller.userScripts();
        controller.removeAllUserScripts();
        for previous in existing.iter() {
            if !previous
                .source()
                .to_string()
                .starts_with("/* bettershape-design-bridge */")
            {
                controller.addUserScript(&previous);
            }
        }
        controller.addUserScript(&script);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn install_on_linux(webview: &tauri::webview::PlatformWebview, script: &str) -> Result<(), String> {
    use std::cell::RefCell;
    use webkit2gtk::{
        UserContentInjectedFrames, UserContentManager, UserContentManagerExt, UserScript,
        UserScriptInjectionTime, WebViewExt,
    };
    thread_local! {
        static INSTALLED: RefCell<Option<(UserContentManager, UserScript)>> = const { RefCell::new(None) };
    }
    let manager = webview
        .inner()
        .user_content_manager()
        .ok_or("The WebKit user-content manager is unavailable.")?;
    let script = UserScript::new(
        script,
        UserContentInjectedFrames::AllFrames,
        UserScriptInjectionTime::Start,
        &[],
        &[],
    );
    manager.add_script(&script);
    // Remove only our script. Tauri's IPC/bootstrap scripts must survive.
    INSTALLED.with(|installed| {
        if let Some((previous_manager, previous_script)) =
            installed.replace(Some((manager, script)))
        {
            previous_manager.remove_script(&previous_script);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapped_bridge_is_identifiable_and_gated_to_preview_iframes() {
        let wrapped = wrap_iframe_only("example();");
        assert!(wrapped.starts_with("/* bettershape-design-bridge */"));
        assert!(wrapped.contains("if (window.top === window) return"));
        assert!(wrapped.contains("h !== \"localhost\""));
        assert!(wrapped.contains("port === \"48921\""));
        assert!(wrapped.contains("example();"));
    }

    #[tokio::test]
    async fn registration_waits_for_successful_native_acknowledgement() {
        let (send, receive) = oneshot::channel();
        let task = tokio::spawn(await_registration(
            receive,
            Arc::new(RegistrationGate::default()),
            std::time::Duration::from_secs(1),
        ));
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        send.send(Ok(())).unwrap();
        assert!(task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn registration_rejects_native_failure_closed_channel_and_timeout() {
        let (send, receive) = oneshot::channel();
        send.send(Err("native rejected".into())).unwrap();
        assert!(await_registration(
            receive,
            Arc::new(RegistrationGate::default()),
            std::time::Duration::from_secs(1)
        )
        .await
        .is_err());
        let (send, receive) = oneshot::channel();
        drop(send);
        assert!(await_registration(
            receive,
            Arc::new(RegistrationGate::default()),
            std::time::Duration::from_secs(1)
        )
        .await
        .is_err());
        let (send, receive) = oneshot::channel();
        let gate = Arc::new(RegistrationGate::default());
        assert!(
            await_registration(receive, Arc::clone(&gate), std::time::Duration::ZERO)
                .await
                .is_err()
        );
        assert!(send.is_closed());
        assert!(!gate.try_commit());
    }
    #[tokio::test]
    async fn claimed_native_commit_keeps_its_receiver_after_the_deadline() {
        let (send, receive) = oneshot::channel();
        let gate = Arc::new(RegistrationGate::default());
        assert!(gate.try_commit());
        let task = tokio::spawn(await_registration(receive, gate, std::time::Duration::ZERO));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(!task.is_finished());
        send.send(Ok(())).unwrap();
        assert!(task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn dropping_a_pending_caller_prevents_late_native_replacement() {
        let (_send, receive) = oneshot::channel();
        let gate = Arc::new(RegistrationGate::default());
        let task = tokio::spawn(await_registration(
            receive,
            Arc::clone(&gate),
            std::time::Duration::from_secs(10),
        ));
        tokio::task::yield_now().await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(!gate.try_commit());
    }
}
