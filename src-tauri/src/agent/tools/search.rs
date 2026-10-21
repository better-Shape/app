use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct GrepOptions {
    pub path: Option<String>,
    pub glob: Option<String>,
    pub context: usize,
    pub case_sensitive: bool,
    pub head_limit: usize,
}

impl Default for GrepOptions {
    fn default() -> Self {
        Self {
            path: None,
            glob: None,
            context: 0,
            case_sensitive: false,
            head_limit: 80,
        }
    }
}

pub async fn execute_grep(query: &str, project_path: &Option<String>, opts: GrepOptions) -> String {
    let Some(path) = project_path else {
        return "No project open.".to_string();
    };

    let search_path = std::path::PathBuf::from(path);
    let head_limit = opts.head_limit.clamp(1, 200);
    let context = opts.context.min(3);
    let scope = opts
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Models sometimes pass a file path to grep; return that file directly.
    // Must go through the same sensitive-path guards as read_file.
    let clean_query = query.trim_start_matches(|c| c == '/' || c == '\\');
    if scope.is_none() && !clean_query.contains("..") {
        match crate::agent::security::paths::validate_read_path(clean_query, path) {
            Ok(target) if target.is_file() => {
                if let Ok(content) = std::fs::read_to_string(&target) {
                    let char_count = content.chars().count();
                    if char_count > 16_000 {
                        let head: String = content.chars().take(16_000).collect();
                        return format!(
                            "File {}:\n{}\n\n[truncated — file is {} chars; use read_file with start_line/end_line to see more]",
                            clean_query, head, char_count
                        );
                    }
                    return format!("File {}:\n{}", clean_query, content);
                }
            }
            Ok(target) if target.is_dir() => {
                return match crate::agent::tools::files::list_files(clean_query, path) {
                    Ok(list) => list,
                    Err(e) => format!("ERROR: {e}"),
                };
            }
            Err(e) => {
                // Exact path looked sensitive / out of bounds — do not fall through to rg.
                if search_path.join(clean_query).exists() {
                    return format!("ERROR: {}", e);
                }
            }
            _ => {}
        }
    }

    let rg_target = if let Some(rel) = scope {
        match crate::agent::security::paths::validate_read_path(rel, path) {
            Ok(p) => p,
            Err(e) => return format!("ERROR: {}", e),
        }
    } else {
        search_path.join(".")
    };

    // The native fallback runs when `rg` is missing or fails. It has no glob
    // engine, so compile the same `--glob` filter here: without it the fallback
    // would ignore the requested file filter and return everything.
    let fallback_glob = opts
        .glob
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|g| globset::Glob::new(g).ok())
        .map(|g| g.compile_matcher());

    // Fast search using ripgrep (if available). Try the query as a regex first
    // (so alternations like `foo|bar` work), then fall back to a literal
    // search if the pattern doesn't parse.
    let run_rg = |fixed_string: bool| {
        let mut cmd = std::process::Command::new("rg");
        cmd.current_dir(path)
            .arg("-n")
            .arg("--color")
            .arg("never")
            .arg("--max-columns")
            .arg("240")
            .arg("--max-columns-preview")
            .arg("--glob")
            .arg("!node_modules")
            .arg("--glob")
            .arg("!**/dist/**")
            .arg("--glob")
            .arg("!**/.git/**");
        if !opts.case_sensitive {
            cmd.arg("--ignore-case");
        }
        for glob in crate::agent::security::paths::SENSITIVE_RG_GLOBS {
            cmd.arg("--glob").arg(glob);
        }
        if let Some(g) = opts
            .glob
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            cmd.arg("--glob").arg(g);
        }
        if context > 0 {
            cmd.arg("-C").arg(context.to_string());
        }
        // Soft line cap via rg; we also trim after.
        cmd.arg("-m").arg(head_limit.to_string());
        if fixed_string {
            cmd.arg("-F");
        }
        crate::core::process::hide_console(&mut cmd);
        cmd.arg("-e").arg(query).arg(&rg_target).output()
    };

    let mut rg_out = run_rg(false);
    if let Ok(out) = &rg_out {
        let pattern_error =
            !out.status.success() && !String::from_utf8_lossy(&out.stderr).trim().is_empty();
        if pattern_error {
            rg_out = run_rg(true);
        }
    }

    if let Ok(out) = rg_out {
        let res = String::from_utf8_lossy(&out.stdout).to_string();
        if !res.trim().is_empty() {
            const CHAR_CAP: usize = 8_000;
            let line_count = res.lines().count();
            if res.chars().count() > CHAR_CAP || line_count > head_limit {
                let head: String = res
                    .lines()
                    .take(head_limit)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .chars()
                    .take(CHAR_CAP)
                    .collect();
                return format!(
                    "{}\n... [truncated — showing up to {} lines / {} chars; narrow path/glob/query]",
                    head, head_limit, CHAR_CAP
                );
            }
            return res;
        }
        // rg exit code 1 with empty output = searched successfully, no matches.
        if out.status.code() == Some(1) {
            return "No results found.".to_string();
        }
    }

    // Ultimate fallback native rust search
    let mut output = String::new();
    let mut limits = head_limit.min(50);

    fn search_recursive(
        dir: &std::path::Path,
        q: &str,
        depth: usize,
        limits: &mut usize,
        out: &mut String,
        base: &std::path::Path,
        glob: Option<&globset::GlobMatcher>,
    ) {
        if *limits == 0 || depth > 6 {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if *limits == 0 {
                    break;
                }
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();

                if name.starts_with('.')
                    || matches!(name.as_str(), "node_modules" | "dist" | "build" | "target")
                {
                    continue;
                }

                if p.is_dir() {
                    search_recursive(&p, q, depth + 1, limits, out, base, glob);
                } else if crate::agent::security::paths::is_sensitive_path(&p) {
                    continue;
                } else if glob.map(|g| g.is_match(&p)).unwrap_or(true) {
                    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                        if matches!(
                            ext,
                            "rs" | "ts"
                                | "tsx"
                                | "js"
                                | "jsx"
                                | "json"
                                | "css"
                                | "html"
                                | "md"
                                | "toml"
                                | "go"
                                | "py"
                                | "c"
                                | "cpp"
                                | "java"
                        ) {
                            if let Ok(file) = std::fs::File::open(&p) {
                                use std::io::{BufRead, BufReader};
                                let reader = BufReader::new(file);
                                let q_lower = q.to_lowercase();

                                for (i, line_res) in reader.lines().enumerate() {
                                    if let Ok(line) = line_res {
                                        if line.to_lowercase().contains(&q_lower) {
                                            let rel = p.strip_prefix(base).unwrap_or(&p);
                                            out.push_str(&format!(
                                                "{}:{}\t{}\n",
                                                rel.display(),
                                                i + 1,
                                                line.trim()
                                            ));
                                            *limits -= 1;
                                            if *limits == 0 {
                                                break;
                                            }
                                        }
                                    }
                                    if i > 10000 {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let base_path = std::path::PathBuf::from(path);
    let start = if rg_target.is_file() {
        rg_target.parent().unwrap_or(&base_path).to_path_buf()
    } else {
        rg_target.clone()
    };
    if rg_target.is_file() {
        // Narrow fallback: search just that file's parent walk is wasteful — read the file.
        if let Ok(content) = std::fs::read_to_string(&rg_target) {
            let q_lower = query.to_lowercase();
            let rel = rg_target.strip_prefix(&base_path).unwrap_or(&rg_target);
            let glob_ok = fallback_glob
                .as_ref()
                .map(|g| g.is_match(&rg_target))
                .unwrap_or(true);
            let mut hits = 0usize;
            for (i, line) in content.lines().enumerate() {
                if glob_ok && line.to_lowercase().contains(&q_lower) {
                    output.push_str(&format!("{}:{}\t{}\n", rel.display(), i + 1, line.trim()));
                    hits += 1;
                    if hits >= head_limit {
                        break;
                    }
                }
            }
        }
    } else {
        search_recursive(
            &start,
            query,
            0,
            &mut limits,
            &mut output,
            &base_path,
            fallback_glob.as_ref(),
        );
    }

    if output.is_empty() {
        "No results found.".to_string()
    } else {
        output
    }
}

pub async fn execute_file_search(query: &str, project_path: &Option<String>) -> String {
    let Some(path) = project_path else {
        return "No project open.".to_string();
    };

    let mut results = Vec::new();
    let q_lower = query.to_lowercase();

    let walk_dir = walkdir::WalkDir::new(path).into_iter().filter_entry(|e| {
        // The root itself is the project the user opened; skipping it because
        // its name starts with a dot would stop the walk before it begins.
        if e.depth() == 0 {
            return true;
        }
        let name = e.file_name().to_string_lossy();
        !name.starts_with('.')
            && name != "node_modules"
            && name != "target"
            && name != "dist"
            && name != "build"
    });

    for entry in walk_dir.filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let path_str = entry.path().to_string_lossy().to_lowercase();
            if path_str.contains(&q_lower) {
                let rel = entry.path().strip_prefix(path).unwrap_or(entry.path());
                results.push(rel.display().to_string().replace('\\', "/"));
                if results.len() >= 100 {
                    results.push("... [truncated, more than 100 results]".to_string());
                    break;
                }
            }
        }
    }

    if results.is_empty() {
        "No matching files found.".to_string()
    } else {
        results.join("\n")
    }
}

/// Web search via the user's own search API (Tavily or Brave).
pub async fn execute_web_search(query: &str, _api_key: &str) -> String {
    let config = crate::core::ai_providers::search_config();
    let provider = config.provider.trim().to_ascii_lowercase();
    if config.api_key.trim().is_empty() || provider.is_empty() || provider == "none" {
        return "Web search is off. Add a Tavily or Brave API key in Settings → Providers to let the agent search the web."
            .to_string();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return format!("Web search request failed: {e}"),
    };

    match provider.as_str() {
        "tavily" => tavily_search(&client, &config.api_key, query).await,
        "brave" => brave_search(&client, &config.api_key, query).await,
        other => format!(
            "Unknown web search provider '{other}'. Use 'tavily' or 'brave' in Settings → Providers."
        ),
    }
}

async fn tavily_search(client: &reqwest::Client, api_key: &str, query: &str) -> String {
    let resp = client
        .post("https://api.tavily.com/search")
        .header("Content-Type", "application/json")
        .json(&json!({
            "api_key": api_key,
            "query": query,
            "max_results": 6,
            "include_answer": true,
            "search_depth": "basic",
        }))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return format!("Web search request failed: {e}"),
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return format!(
            "Web search error {status}: {}",
            text.chars().take(300).collect::<String>()
        );
    }
    let data: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return format!("Failed to parse web search response: {e}"),
    };

    let mut out = String::new();
    if let Some(answer) = data.get("answer").and_then(|a| a.as_str()) {
        if !answer.trim().is_empty() {
            out.push_str(&format!("Answer: {}\n\n", answer.trim()));
        }
    }
    if let Some(results) = data.get("results").and_then(|r| r.as_array()) {
        for (i, item) in results.iter().enumerate() {
            let title = item
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("Untitled");
            let url = item.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let content = item.get("content").and_then(|c| c.as_str()).unwrap_or("");
            out.push_str(&format!(
                "{}. {title}\n   {url}\n   {}\n\n",
                i + 1,
                content.chars().take(400).collect::<String>()
            ));
        }
    }
    if out.trim().is_empty() {
        "No web results found.".to_string()
    } else {
        out.trim_end().to_string()
    }
}

async fn brave_search(client: &reqwest::Client, api_key: &str, query: &str) -> String {
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[("q", query), ("count", "6")])
        .header("Accept", "application/json")
        .header("X-Subscription-Token", api_key)
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return format!("Web search request failed: {e}"),
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return format!(
            "Web search error {status}: {}",
            text.chars().take(300).collect::<String>()
        );
    }
    let data: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return format!("Failed to parse web search response: {e}"),
    };

    let mut out = String::new();
    if let Some(results) = data
        .get("web")
        .and_then(|w| w.get("results"))
        .and_then(|r| r.as_array())
    {
        for (i, item) in results.iter().enumerate() {
            let title = item
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("Untitled");
            let url = item.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let description = item
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("");
            out.push_str(&format!(
                "{}. {title}\n   {url}\n   {}\n\n",
                i + 1,
                strip_html(description)
                    .chars()
                    .take(400)
                    .collect::<String>()
            ));
        }
    }
    if out.trim().is_empty() {
        "No web results found.".to_string()
    } else {
        out.trim_end().to_string()
    }
}

#[derive(Debug, Clone)]
pub struct VisitUrlResult {
    pub formatted: String,
    pub title: String,
    pub url: String,
    pub host: String,
}

/// Fetch a page directly (no server round-trip) and reduce it to readable text.
pub async fn execute_visit_url(url: &str, _api_key: &str) -> Result<VisitUrlResult, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http(s) URLs can be opened.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; BetterShape/1.0)")
        // Redirects are followed by hand so each hop passes the same SSRF
        // check as the first URL; reqwest's own policy would follow a public
        // page's Location straight to a private address.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Visit URL request failed: {e}"))?;

    let mut current = parsed;
    let mut hops = 0usize;
    let resp = loop {
        let resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|e| format!("Visit URL request failed: {e}"))?;
        if !resp.status().is_redirection() {
            break resp;
        }
        hops += 1;
        if hops > 5 {
            return Err("Too many redirects.".to_string());
        }
        let Some(location) = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
        else {
            break resp;
        };
        let next = current
            .join(location)
            .map_err(|e| format!("Invalid redirect target: {e}"))?;
        if !matches!(next.scheme(), "http" | "https") {
            return Err("Redirect left http(s).".to_string());
        }
        current = crate::agent::security::urls::validate_outbound_url_resolved(next.as_str())
            .await
            .and_then(|u| url::Url::parse(&u).map_err(|e| e.to_string()))
            .map_err(|e| format!("Redirect refused: {e}"))?;
    };

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Visit URL error {status}"));
    }
    let final_url = resp.url().to_string();
    // The host is the one the content actually came from, after any redirects.
    let host = resp.url().host_str().unwrap_or("").to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // A page body is model input, not a file to download. Read it in chunks and
    // stop at the cap so a hostile or runaway server cannot buffer unbounded
    // bytes into memory before the later per-format truncation runs.
    let body = {
        const MAX_BODY_BYTES: usize = 2_000_000;
        let mut resp = resp;
        let mut bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("Could not read page body: {e}"))?
        {
            if bytes.len() >= MAX_BODY_BYTES {
                break;
            }
            let room = MAX_BODY_BYTES - bytes.len();
            bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    };

    let title = extract_title(&body);
    let formatted = if content_type.contains("json") {
        body.chars().take(60_000).collect::<String>()
    } else if content_type.contains("html") || body.contains('<') {
        html_to_text(&body)
    } else {
        body.chars().take(60_000).collect::<String>()
    };

    if formatted.trim().is_empty() {
        return Err("No page content extracted.".to_string());
    }

    Ok(VisitUrlResult {
        formatted,
        title,
        url: final_url,
        host,
    })
}

fn extract_title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(start) = lower.find("<title") else {
        return String::new();
    };
    let Some(open_end) = lower[start..].find('>') else {
        return String::new();
    };
    let body_start = start + open_end + 1;
    let Some(close) = lower[body_start..].find("</title>") else {
        return String::new();
    };
    decode_entities(html[body_start..body_start + close].trim())
}

/// Strip markup down to readable text. Dependency-free on purpose: this runs on
/// the agent's hot path and only needs to feed a model, not render a page.
fn html_to_text(html: &str) -> String {
    let without_blocks = remove_blocks(html, &["script", "style", "noscript", "svg", "head"]);

    let mut out = String::with_capacity(without_blocks.len());
    let mut in_tag = false;
    let mut last_was_space = true;
    for ch in without_blocks.chars() {
        match ch {
            '<' => {
                in_tag = true;
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            }
            '>' => in_tag = false,
            _ if in_tag => {}
            '\n' | '\r' | '\t' => {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            }
            _ => {
                let is_space = ch == ' ';
                if !(is_space && last_was_space) {
                    out.push(ch);
                    last_was_space = is_space;
                }
            }
        }
    }

    decode_entities(out.trim())
        .chars()
        .take(60_000)
        .collect::<String>()
}

/// Remove every `<tag>…</tag>` block (case-insensitive), plus unclosed openings.
fn remove_blocks(html: &str, tags: &[&str]) -> String {
    let mut current = html.to_string();
    for tag in tags {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        // Tags are rare enough that a bounded number of passes is fine.
        for _ in 0..64 {
            let lower = current.to_ascii_lowercase();
            let Some(start) = lower.find(&open) else {
                break;
            };
            let Some(close_start) = lower[start..].find(&close) else {
                current.truncate(start);
                break;
            };
            let end = start + close_start + close.len();
            current.replace_range(start..end, " ");
        }
    }
    current
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if in_tag => {}
            _ => out.push(ch),
        }
    }
    decode_entities(out.trim())
}

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_becomes_readable_text() {
        let html = r#"<html><head><title>Docs</title><style>.a{color:red}</style></head>
            <body><h1>Hello</h1><script>alert(1)</script><p>World &amp; friends</p></body></html>"#;
        assert_eq!(extract_title(html), "Docs");
        let text = html_to_text(html);
        assert!(text.contains("Hello"));
        assert!(text.contains("World & friends"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("<h1>"));
    }

    #[test]
    fn search_without_a_key_explains_itself() {
        let text = futures::executor::block_on(execute_web_search("rust", ""));
        assert!(text.contains("Settings"));
    }

    #[test]
    fn a_dot_named_project_still_searches_its_root() {
        // The walk filter skips dot directories, but the opened project is the
        // root of the walk: if the root is skipped nothing is ever found.
        let root = std::env::temp_dir().join(format!(".bs-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("findme.rs"), "fn x() {}").unwrap();
        let text = futures::executor::block_on(execute_file_search(
            "findme",
            &Some(root.to_string_lossy().to_string()),
        ));
        assert!(text.contains("findme.rs"), "{text}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
