use std::sync::Arc;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Notify};

use crate::core::error::AppError;

const INJECT_MARK: &str = "<!--bettershape-design-bridge-->";

pub struct DesignProxyState {
    inner: Mutex<Option<RunningProxy>>,
}

struct RunningProxy {
    port: u16,
    target: String,
    inject: bool,
    token: Arc<String>,
    shutdown: Arc<Notify>,
}

impl Default for DesignProxyState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
pub struct DesignProxyInfo {
    pub port: u16,
    pub src: String,
}

fn inject_bridge(html: &str, script: &str) -> String {
    if html.contains(INJECT_MARK) {
        return html.to_string();
    }
    // Run after window load so React/Vite can hydrate and play intro animations
    // before we attach inspectors. Inject at </body> so we don't block <head> scripts.
    let tag = format!(
        "{INJECT_MARK}<script>(function(){{function boot(){{{script}\n}}if(document.readyState==='complete')boot();else window.addEventListener('load',boot);}})();</script>"
    );
    let lower = html.to_ascii_lowercase();
    if let Some(idx) = lower.rfind("</body>") {
        let mut out = String::with_capacity(html.len() + tag.len());
        out.push_str(&html[..idx]);
        out.push_str(&tag);
        out.push_str(&html[idx..]);
        return out;
    }
    if let Some(idx) = lower.rfind("</html>") {
        let mut out = String::with_capacity(html.len() + tag.len());
        out.push_str(&html[..idx]);
        out.push_str(&tag);
        out.push_str(&html[idx..]);
        return out;
    }
    format!("{html}{tag}")
}

fn host_header(parsed: &url::Url) -> String {
    let host = parsed.host_str().unwrap_or("localhost");
    match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

const FRAME_ANCESTORS: &str = "frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost http://asset.localhost https://asset.localhost http://localhost:* http://127.0.0.1:*";

fn rewrite_csp_frame_ancestors(csp: &str) -> String {
    let mut parts: Vec<String> = csp
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut found = false;
    for part in parts.iter_mut() {
        if part.to_ascii_lowercase().starts_with("frame-ancestors") {
            *part = FRAME_ANCESTORS.to_string();
            found = true;
        }
    }
    if !found {
        parts.push(FRAME_ANCESTORS.to_string());
    }
    parts.join("; ")
}

fn assert_loopback_target(parsed: &url::Url, what: &str) -> Result<(), AppError> {
    let ok = match parsed.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(d)) => {
            let l = d.to_ascii_lowercase();
            l == "localhost" || l.ends_with(".localhost")
        }
        None => false,
    };
    ok.then_some(())
        .ok_or_else(|| AppError::Message(format!("{what} requires loopback.")))
}

fn origin_of(parsed: &url::Url) -> String {
    format!(
        "{}://{}{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or("localhost"),
        parsed.port().map(|p| format!(":{p}")).unwrap_or_default()
    )
}

const PROXY_TOKEN_PARAM: &str = "__bettershape_proxy_token";

fn proxy_src(listen_port: u16, parsed: &url::Url, token: Option<&str>) -> String {
    // Listener is bound to 127.0.0.1 — using "localhost" here can hit ::1 on Windows
    // and show the OS "refused to connect" page.
    let mut out = format!("http://127.0.0.1:{listen_port}{}", parsed.path());
    if let Some(q) = parsed.query() {
        out.push('?');
        out.push_str(q);
    }
    if let Some(t) = token {
        out.push_str(&format!(
            "{}{PROXY_TOKEN_PARAM}={t}",
            match parsed.query() {
                Some("") => "",
                Some(_) => "&",
                None => "?",
            }
        ));
    }
    if let Some(f) = parsed.fragment().filter(|f| !f.is_empty()) {
        out.push('#');
        out.push_str(f);
    }
    out
}

fn extract_and_strip_proxy_token(q: Option<&str>, exp: &str) -> (bool, Option<String>) {
    let Some(q) = q else { return (false, None) };
    let (mut m, mut k) = (false, Vec::new());
    for p in q.split('&').filter(|p| !p.is_empty()) {
        if let Some((PROXY_TOKEN_PARAM, v)) = p.split_once('=') {
            m |= v == exp;
        } else {
            k.push(p);
        }
    }
    (m, (!k.is_empty()).then(|| k.join("&")))
}

fn rewrite_location(value: &str, listen_port: u16, target: &url::Url, token: &str) -> String {
    if let Ok(u) = target.join(value) {
        if u.host_str() == target.host_str()
            && u.port_or_known_default() == target.port_or_known_default()
        {
            return proxy_src(listen_port, &u, Some(token));
        }
    }
    value.to_string()
}

async fn handle_client(
    mut client: TcpStream,
    target: url::Url,
    script: Arc<String>,
    listen_port: u16,
    token: Arc<String>,
) {
    let mut buf = vec![0u8; 64 * 1024];
    let n = match client.read(&mut buf).await {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };
    let req = &buf[..n];
    let header_end = req.windows(4).position(|w| w == b"\r\n\r\n");
    let Some(header_end) = header_end else { return };
    let header_text = String::from_utf8_lossy(&req[..header_end]);
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");

    if method.eq_ignore_ascii_case("CONNECT") || path.starts_with("ws") {
        let _ = client.shutdown().await;
        return;
    }

    let mut dest = target.clone();
    let mut query_token_ok = false;
    if let Ok(rel) = url::Url::parse(&format!("http://placeholder.local{path}")) {
        dest.set_path(rel.path());
        let (matched, cleaned_q) = extract_and_strip_proxy_token(rel.query(), &token);
        query_token_ok = matched;
        dest.set_query(cleaned_q.as_deref());
    }
    let hdr = |k: &str| {
        lines.clone().find_map(|l| {
            l.split_once(':')
                .and_then(|(n, v)| n.trim().eq_ignore_ascii_case(k).then_some(v.trim()))
        })
    };
    let ref_ok = hdr("referer")
        .and_then(|r| url::Url::parse(r).ok())
        .map(|u| {
            extract_and_strip_proxy_token(u.query(), &token).0
                || (u.host_str() == Some("127.0.0.1")
                    && u.port() == Some(listen_port)
                    && hdr("sec-fetch-site") == Some("same-origin"))
        })
        .unwrap_or(false);
    if !query_token_ok && !ref_ok {
        let _ = client.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden").await;
        return;
    }

    let client_http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build();
    let Ok(http) = client_http else { return };

    let mut builder = http.request(
        method
            .parse::<reqwest::Method>()
            .unwrap_or(reqwest::Method::GET),
        dest.clone(),
    );
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        let lower = name.to_ascii_lowercase();
        if lower == "host" || lower == "connection" || lower == "accept-encoding" {
            continue;
        }
        builder = builder.header(name, value);
    }
    builder = builder.header("host", host_header(&dest));
    builder = builder.header("accept-encoding", "identity");

    let body = &req[header_end + 4..];
    if !body.is_empty() {
        builder = builder.body(body.to_vec());
    }

    let resp = match builder.send().await {
        Ok(r) => r,
        Err(_) => {
            let msg = b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 11\r\n\r\nBad Gateway";
            let _ = client.write_all(msg).await;
            return;
        }
    };

    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp.bytes().await.unwrap_or_default();
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut out_body = bytes.to_vec();
    if !script.is_empty() && content_type.contains("text/html") {
        if let Ok(html) = std::str::from_utf8(&out_body) {
            out_body = inject_bridge(html, &script).into_bytes();
        }
    }

    let mut head = format!(
        "HTTP/1.1 {} {}\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("OK")
    );
    for (name, value) in headers.iter() {
        let lower = name.as_str().to_ascii_lowercase();
        if lower == "content-length"
            || lower == "transfer-encoding"
            || lower == "content-encoding"
            || lower == "connection"
            || lower == "x-frame-options"
        {
            continue;
        }
        let mut val = value.to_str().unwrap_or("").to_string();
        if lower == "location" {
            val = rewrite_location(&val, listen_port, &dest, &token);
        }
        if lower == "content-security-policy" || lower == "content-security-policy-report-only" {
            val = rewrite_csp_frame_ancestors(&val);
        }
        head.push_str(name.as_str());
        head.push_str(": ");
        head.push_str(&val);
        head.push_str("\r\n");
    }
    head.push_str("Referrer-Policy: same-origin\r\n");
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        out_body.len()
    ));
    let _ = client.write_all(head.as_bytes()).await;
    let _ = client.write_all(&out_body).await;
}

#[tauri::command]
pub async fn start_design_proxy(
    target_url: String,
    bridge_script: String,
    state: tauri::State<'_, DesignProxyState>,
) -> Result<DesignProxyInfo, AppError> {
    let parsed = url::Url::parse(&target_url)
        .map_err(|e| AppError::Message(format!("Invalid preview URL: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::Message(
            "Design mode only supports http(s) preview URLs.".into(),
        ));
    }
    assert_loopback_target(&parsed, "Design proxy")?;

    let inject = !bridge_script.trim().is_empty();

    {
        let guard = state.inner.lock().await;
        if let Some(running) = guard.as_ref() {
            if running.target == origin_of(&parsed) && running.inject == inject {
                return Ok(DesignProxyInfo {
                    port: running.port,
                    src: proxy_src(running.port, &parsed, Some(&running.token)),
                });
            }
        }
    }

    stop_running(&*state).await;

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let shutdown = Arc::new(Notify::new());
    let shutdown_worker = shutdown.clone();
    let origin = origin_of(&parsed);
    let base = parsed.clone();
    let script = Arc::new(bridge_script);
    let token = Arc::new(uuid::Uuid::new_v4().simple().to_string());
    let token_worker = token.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_worker.notified() => break,
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _)) => {
                            let script = script.clone();
                            let target = base.clone();
                            let tok = token_worker.clone();
                            tokio::spawn(async move {
                                handle_client(stream, target, script, port, tok).await;
                            });
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });

    let src = proxy_src(port, &parsed, Some(&token));

    *state.inner.lock().await = Some(RunningProxy {
        port,
        target: origin,
        inject,
        token,
        shutdown,
    });

    Ok(DesignProxyInfo { port, src })
}

async fn stop_running(state: &DesignProxyState) {
    if let Some(running) = state.inner.lock().await.take() {
        running.shutdown.notify_waiters();
    }
}

#[tauri::command]
pub async fn stop_design_proxy(state: tauri::State<'_, DesignProxyState>) -> Result<(), AppError> {
    stop_running(&*state).await;
    Ok(())
}

/// TCP reachability check so the iframe is never pointed at a dead port
/// (WebView would show the OS “refused to connect” page).
#[tauri::command]
pub async fn probe_preview_url(url: String) -> Result<bool, AppError> {
    let parsed = url::Url::parse(&url)
        .map_err(|e| AppError::Message(format!("Invalid preview URL: {e}")))?;
    assert_loopback_target(&parsed, "Preview probe")?;
    let host = parsed.host_str().unwrap_or("localhost");
    let port = parsed.port_or_known_default().unwrap_or(80);
    // IPv4 only — [::1] on Windows can stall far past the connect timeout.
    // Prefer 127.0.0.1 first: Next/Vite are started with `--hostname 127.0.0.1`,
    // and Windows `localhost` often tries `[::1]` which is not listening.
    let mut candidates = Vec::new();
    let lower = host.to_ascii_lowercase();
    let local = matches!(
        lower.as_str(),
        "localhost" | "0.0.0.0" | "::1" | "[::1]" | "127.0.0.1"
    );
    if local {
        candidates.push(format!("127.0.0.1:{port}"));
        candidates.push(format!("localhost:{port}"));
    } else {
        candidates.push(format!("{host}:{port}"));
    }
    // Remote hosts need DNS + a real round trip; loopback answers instantly.
    let timeout = std::time::Duration::from_millis(if local { 400 } else { 4000 });
    log::info!("[preview] probe_preview_url {}", url);
    for addr in candidates {
        let connect = TcpStream::connect(&addr);
        match tokio::time::timeout(timeout, connect).await {
            Ok(Ok(_stream)) => {
                log::info!("[preview] probe_preview_url OK {}", addr);
                return Ok(true);
            }
            Ok(Err(err)) => {
                log::debug!("[preview] probe_preview_url refuse {}: {}", addr, err);
            }
            Err(_) => {
                log::debug!("[preview] probe_preview_url timeout {}", addr);
            }
        }
    }
    log::info!("[preview] probe_preview_url FAIL {}", url);
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proxy_checks() {
        for u in [
            "http://localhost:5173/",
            "http://127.0.0.1:3000/app",
            "http://[::1]:8080/",
            "http://app.localhost:5173/",
        ] {
            assert!(assert_loopback_target(&url::Url::parse(u).unwrap(), "t").is_ok());
        }
        for u in [
            "http://192.168.1.10:5173/",
            "http://10.0.0.2/",
            "https://example.com/",
            "http://evil-localhost.com/",
        ] {
            assert!(assert_loopback_target(&url::Url::parse(u).unwrap(), "t").is_err());
        }
        let out = rewrite_csp_frame_ancestors("default-src 'self'; frame-ancestors *");
        assert!(
            !out.contains("frame-ancestors *")
                && out.contains("tauri.localhost")
                && extract_and_strip_proxy_token(
                    Some("a=1&__bettershape_proxy_token=x&b=2"),
                    "x"
                ) == (true, Some("a=1&b=2".into()))
                && !extract_and_strip_proxy_token(
                    Some("__bettershape_proxy_token=y"),
                    "x"
                )
                .0
        );
    }
}
