/// Outbound URL checks for browse / visit_url (SSRF class).
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use url::Host;

static PROXY_PORT: tokio::sync::OnceCell<u16> = tokio::sync::OnceCell::const_new();

fn ipv4_blocked(v4: &Ipv4Addr) -> bool {
    let o = v4.octets();
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_multicast()
        || v4.is_broadcast()
        || v4.is_unspecified()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64)
        || (o[0] == 198 && (o[1] & 0xfe) == 18)
        || (o[0] & 0xf0) == 240
}

pub fn ip_blocked(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_blocked(v4),
        IpAddr::V6(v6) => {
            if let Some(m) = v6.to_ipv4_mapped() {
                return ipv4_blocked(&m);
            }
            let s = v6.segments();
            if s[0] == 0x0064 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
                return ipv4_blocked(&Ipv4Addr::new(
                    (s[6] >> 8) as u8,
                    s[6] as u8,
                    (s[7] >> 8) as u8,
                    s[7] as u8,
                ));
            }
            if s[0] == 0x2002 {
                return ipv4_blocked(&Ipv4Addr::new(
                    (s[1] >> 8) as u8,
                    s[1] as u8,
                    (s[2] >> 8) as u8,
                    s[2] as u8,
                ));
            }
            v6.is_loopback()
                || v6.is_multicast()
                || v6.is_unspecified()
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] & 0xffc0) == 0xfec0
                || (s[0] & 0xfe00) == 0xfc00
        }
    }
}

pub fn check_resolved_ips(ips: &[IpAddr]) -> Result<(), String> {
    if ips.is_empty() {
        return Err("Host could not be resolved.".into());
    }
    if ips.iter().any(ip_blocked) {
        return Err("Restricted network address.".into());
    }
    Ok(())
}

pub fn validate_outbound_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL is required.".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if [
        "javascript:",
        "data:",
        "file:",
        "vbscript:",
        "blob:",
        "chrome:",
        "tauri:",
    ]
    .iter()
    .any(|b| lower.starts_with(b))
    {
        return Err("Only http and https URLs are allowed.".to_string());
    }
    if trimmed.contains("://")
        && !(trimmed.starts_with("http://") || trimmed.starts_with("https://"))
    {
        return Err("Only http and https URLs are allowed.".to_string());
    }
    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = url::Url::parse(&candidate).map_err(|_| "Invalid URL.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https URLs are allowed.".to_string()),
    }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if host.is_empty() {
        return Err("URL is missing a host.".to_string());
    }
    const BLOCKED_HOSTS: &[&str] = &[
        "169.254.169.254",
        "metadata.google.internal",
        "metadata.goog",
        "10.20.0.3",
    ];
    if BLOCKED_HOSTS.iter().any(|h| host == *h) {
        return Err("That host cannot be fetched.".to_string());
    }
    match parsed.host() {
        Some(Host::Ipv4(ip)) if ip_blocked(&IpAddr::V4(ip)) => {
            return Err("That host cannot be fetched.".into())
        }
        Some(Host::Ipv6(ip)) if ip_blocked(&IpAddr::V6(ip)) => {
            return Err("That host cannot be fetched.".into())
        }
        Some(Host::Domain(domain)) => {
            let d = domain.trim_end_matches('.').to_ascii_lowercase();
            if [
                "localhost",
                "metadata.azure.internal",
                "metadata",
                "instance-data",
            ]
            .contains(&d.as_str())
                || d.ends_with(".localhost")
                || d.ends_with(".internal")
                || d.ends_with(".local")
                || d.parse::<IpAddr>()
                    .map(|ip| ip_blocked(&ip))
                    .unwrap_or(false)
            {
                return Err("That host cannot be fetched.".into());
            }
        }
        _ => {}
    }
    Ok(candidate)
}

async fn resolve_validated_addrs(raw: &str) -> Result<(url::Url, Vec<SocketAddr>), String> {
    let u = url::Url::parse(&validate_outbound_url(raw)?).map_err(|e| e.to_string())?;
    let p = u
        .port_or_known_default()
        .unwrap_or(if u.scheme() == "https" { 443 } else { 80 });
    let a = match u.host() {
        Some(Host::Domain(d)) => {
            let a: Vec<_> = tokio::net::lookup_host((d, p))
                .await
                .map_err(|_| "Unresolved host.".to_string())?
                .collect();
            check_resolved_ips(&a.iter().map(|x| x.ip()).collect::<Vec<_>>())?;
            a
        }
        Some(Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), p)],
        Some(Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), p)],
        None => return Err("Missing host.".into()),
    };
    Ok((u, a))
}

pub async fn validate_outbound_url_resolved(raw: &str) -> Result<String, String> {
    resolve_validated_addrs(raw)
        .await
        .map(|(u, _)| u.to_string())
}

async fn handle_proxy(mut c: tokio::net::TcpStream) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (mut b, mut n) = (vec![0u8; 16384], 0usize);
    let end = loop {
        if let Some(i) = b[..n].windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if n == b.len() {
            return;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(5), c.read(&mut b[n..])).await {
            Ok(Ok(k)) if k > 0 => n += k,
            _ => return,
        }
    };
    let h = String::from_utf8_lossy(&b[..end]);
    let (f, rest) = h.split_once("\r\n").unwrap_or((&h, ""));
    let mut it = f.split_whitespace();
    let (Some(m), Some(t), Some(v)) = (it.next(), it.next(), it.next()) else {
        return;
    };
    let conn = m.eq_ignore_ascii_case("CONNECT");
    let raw = if conn {
        format!("https://{t}/")
    } else if t.starts_with("http://") || t.starts_with("https://") {
        t.into()
    } else {
        return;
    };
    let Ok((u, a)) = resolve_validated_addrs(&raw).await else {
        let _ = c.write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n").await;
        return;
    };
    let Ok(Ok(mut up)) = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        tokio::net::TcpStream::connect(&a[..]),
    )
    .await
    else {
        let _ = c.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
        return;
    };
    let ok = if conn {
        c.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await
            .is_ok()
    } else {
        let pq = u
            .query()
            .map(|q| format!("{}?{q}", u.path()))
            .unwrap_or_else(|| u.path().into());
        up.write_all(format!("{m} {pq} {v}\r\n{rest}\r\n\r\n").as_bytes())
            .await
            .is_ok()
    };
    if ok && (end + 4 >= n || up.write_all(&b[end + 4..n]).await.is_ok()) {
        let _ = tokio::io::copy_bidirectional(&mut c, &mut up).await;
    }
}

pub async fn ensure_browse_proxy() -> Result<u16, String> {
    PROXY_PORT
        .get_or_try_init(|| async {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| e.to_string())?;
            let p = l.local_addr().map_err(|e| e.to_string())?.port();
            tokio::spawn(async move {
                while let Ok((s, _)) = l.accept().await {
                    tokio::spawn(handle_proxy(s));
                }
            });
            Ok(p)
        })
        .await
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_and_localhost() {
        assert!(validate_outbound_url("https://example.com/docs").is_ok());
        assert!(
            validate_outbound_url("http://127.0.0.1:5173/").is_err()
                && validate_outbound_url("http://localhost:3000/").is_err()
        );
        assert_eq!(
            validate_outbound_url("example.com/a").unwrap(),
            "https://example.com/a"
        );
    }

    #[test]
    fn blocks_file_and_metadata() {
        assert!(validate_outbound_url("file:///etc/passwd").is_err());
        assert!(validate_outbound_url("javascript:alert(1)").is_err());
        assert!(validate_outbound_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_outbound_url("http://metadata.google.internal/").is_err());
        for u in [
            "http://192.168.1.1/",
            "http://10.0.0.5/",
            "http://172.16.0.9/",
            "http://100.64.0.1/",
            "http://[fe80::1]/",
            "http://[fd00::1]/",
            "http://[::ffff:169.254.169.254]/",
            "http://[64:ff9b::a9fe:a9fe]/",
            "http://[2002:a9fe:a9fe::1]/",
            "http://[::1]:8080/",
            "http://0.0.0.0/",
            "http://a.local/",
        ] {
            assert!(validate_outbound_url(u).is_err());
        }
        let (a, b): (IpAddr, IpAddr) = (
            "93.184.216.34".parse().unwrap(),
            "169.254.169.254".parse().unwrap(),
        );
        assert!(
            check_resolved_ips(&[a]).is_ok()
                && check_resolved_ips(&[a, b]).is_err()
                && check_resolved_ips(&[]).is_err()
        );
    }
}
