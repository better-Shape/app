use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestFramework {
    Vitest,
    Jest,
    Playwright,
    Cargo,
    Pytest,
    Go,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestDiscovery {
    pub framework: TestFramework,
    pub test_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCaseResult {
    pub id: String,
    pub name: String,
    pub file: String,
    pub suite: String,
    pub status: String,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunSummary {
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResultEvent {
    pub event_type: String,
    pub framework: String,
    pub test: Option<TestCaseResult>,
    pub summary: Option<TestRunSummary>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PackageJson {
    #[serde(default)]
    scripts: HashMap<String, String>,
    #[serde(default, rename = "devDependencies")]
    dev_dependencies: HashMap<String, String>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct JestStyleResult {
    #[serde(default, rename = "testResults")]
    test_results: Vec<JestStyleSuite>,
    #[serde(default, rename = "numPassedTests")]
    num_passed_tests: u32,
    #[serde(default, rename = "numFailedTests")]
    num_failed_tests: u32,
    #[serde(default, rename = "numPendingTests")]
    num_pending_tests: u32,
    #[serde(default, rename = "numTotalTests")]
    num_total_tests: u32,
}

#[derive(Debug, Deserialize)]
struct JestStyleSuite {
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    status: String,
    #[serde(default, rename = "assertionResults")]
    assertion_results: Vec<JestStyleAssertion>,
}

#[derive(Debug, Deserialize)]
struct JestStyleAssertion {
    #[serde(default, rename = "fullName")]
    full_name: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(default, rename = "failureMessages")]
    failure_messages: Vec<String>,
    #[serde(default, rename = "ancestorTitles")]
    ancestor_titles: Vec<String>,
}

fn npm_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "npx.cmd"
    } else {
        "npx"
    }
}

fn has_dep(map: &HashMap<String, String>, name: &str) -> bool {
    map.contains_key(name)
}

fn detect_framework(project_path: &Path, pkg: &PackageJson) -> TestFramework {
    let scripts = &pkg.scripts;
    let dev = &pkg.dev_dependencies;
    let deps = &pkg.dependencies;

    let has_vitest = has_dep(dev, "vitest") || has_dep(deps, "vitest");
    let has_jest = has_dep(dev, "jest") || has_dep(deps, "jest");
    let has_playwright = ["@playwright/test", "playwright"]
        .iter()
        .any(|k| has_dep(dev, k) || has_dep(deps, k));

    if has_vitest
        || scripts.values().any(|s| s.contains("vitest"))
        || project_path.join("vitest.config.ts").exists()
        || project_path.join("vitest.config.js").exists()
        || project_path.join("vitest.config.mjs").exists()
    {
        return TestFramework::Vitest;
    }

    if has_jest
        || scripts.values().any(|s| s.contains("jest"))
        || project_path.join("jest.config.ts").exists()
        || project_path.join("jest.config.js").exists()
        || project_path.join("jest.config.mjs").exists()
    {
        return TestFramework::Jest;
    }

    if has_playwright
        || scripts.values().any(|s| s.contains("playwright test"))
        || [
            "playwright.config.ts",
            "playwright.config.js",
            "playwright.config.mjs",
        ]
        .iter()
        .any(|f| project_path.join(f).exists())
    {
        return TestFramework::Playwright;
    }

    TestFramework::None
}

fn detect_non_js_framework(p: &Path) -> TestFramework {
    if p.join("Cargo.toml").exists() || p.join("src-tauri/Cargo.toml").exists() {
        TestFramework::Cargo
    } else if p.join("pytest.ini").exists()
        || p.join("conftest.py").exists()
        || std::fs::read_to_string(p.join("pyproject.toml"))
            .map(|s| s.contains("pytest"))
            .unwrap_or(false)
    {
        TestFramework::Pytest
    } else if p.join("go.mod").exists() {
        TestFramework::Go
    } else {
        TestFramework::None
    }
}

fn is_test_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.contains(".test.")
        || name.contains(".spec.")
        || name.ends_with("_test.rs")
        || name.ends_with("_test.go")
        || name.ends_with("_test.py")
        || (name.starts_with("test_") && name.ends_with(".py"))
    {
        return true;
    }
    if path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| n == "__tests__" || (n == "tests" && name.ends_with(".rs")))
        .unwrap_or(false)
    {
        return true;
    }
    false
}

pub fn discover_tests(project_path: String) -> Result<TestDiscovery, String> {
    let root = PathBuf::from(&project_path);
    let pkg_path = root.join("package.json");
    let pkg_raw = if pkg_path.exists() {
        std::fs::read_to_string(&pkg_path).map_err(|e| e.to_string())?
    } else {
        "{}".into()
    };
    let pkg: PackageJson = serde_json::from_str(&pkg_raw).map_err(|e| e.to_string())?;
    let mut framework = detect_framework(&root, &pkg);
    if framework == TestFramework::None {
        framework = detect_non_js_framework(&root);
    }

    let mut test_files = Vec::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        if rel.contains("node_modules")
            || rel.contains("/dist/")
            || rel.contains("/build/")
            || rel.contains("/target/")
            || rel.contains("/.venv/")
        {
            continue;
        }
        if is_test_file(path) {
            test_files.push(path.to_string_lossy().to_string());
        }
    }

    test_files.sort();
    Ok(TestDiscovery {
        framework,
        test_files,
    })
}

fn emit_event(app: &AppHandle, event: TestResultEvent) {
    let _ = app.emit("test-result", event);
}

fn map_assertion_status(status: &str) -> String {
    match status {
        "passed" => "passed".to_string(),
        "failed" => "failed".to_string(),
        "pending" | "todo" => "skipped".to_string(),
        _ => "skipped".to_string(),
    }
}

fn collect_playwright_suites(s: &serde_json::Value, pf: &str, out: &mut Vec<TestCaseResult>) {
    let (f, stt) = (
        s.get("file")
            .and_then(|v| v.as_str())
            .filter(|x| !x.is_empty())
            .unwrap_or(pf),
        s.get("title")
            .and_then(|v| v.as_str())
            .filter(|x| !x.is_empty()),
    );
    let stt = stt.unwrap_or(f);
    for sp in s
        .get("specs")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
    {
        let (tl, sf) = (
            sp.get("title").and_then(|v| v.as_str()).unwrap_or("test"),
            sp.get("file")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
                .unwrap_or(f),
        );
        for t in sp
            .get("tests")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let r = t
                .get("results")
                .and_then(|v| v.as_array())
                .and_then(|a| a.last());
            let raw = r
                .and_then(|x| x.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or(if sp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                    "passed"
                } else {
                    "failed"
                });
            let (exp, oc) = (
                t.get("expectedStatus").and_then(|v| v.as_str()),
                t.get("outcome")
                    .and_then(|v| v.as_str())
                    .or_else(|| t.get("status").and_then(|v| v.as_str())),
            );
            let st = match oc {
                Some("expected" | "flaky") => "passed",
                Some("unexpected") => "failed",
                Some("skipped") => "skipped",
                _ if raw == "skipped" || exp == Some("skipped") => "skipped",
                _ if exp == Some(raw) || matches!(raw, "passed" | "expected") => "passed",
                _ => "failed",
            };
            let id = match t
                .get("projectName")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
            {
                Some(p) => format!("{p}::{sf}::{tl}"),
                None => format!("{sf}::{tl}"),
            };
            out.push(TestCaseResult {
                id,
                name: tl.into(),
                file: sf.into(),
                suite: stt.into(),
                status: st.into(),
                duration_ms: r.and_then(|x| x.get("duration")).and_then(|v| v.as_u64()),
                error: r
                    .and_then(|x| x.get("error"))
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(String::from),
            });
        }
    }
    for c in s
        .get("suites")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
    {
        collect_playwright_suites(c, f, out);
    }
}

fn parse_and_emit_results(
    app: &AppHandle,
    framework: &str,
    json_path: &Path,
) -> Result<TestRunSummary, String> {
    let raw = std::fs::read_to_string(json_path).map_err(|e| e.to_string())?;
    if framework.eq_ignore_ascii_case("playwright") {
        let val: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let (mut cases, mut p, mut f, mut s) = (Vec::new(), 0u32, 0u32, 0u32);
        collect_playwright_suites(&val, "playwright", &mut cases);
        for tc in cases {
            match tc.status.as_str() {
                "passed" => p += 1,
                "failed" => f += 1,
                _ => s += 1,
            }
            emit_event(
                app,
                TestResultEvent {
                    event_type: "test".into(),
                    framework: framework.into(),
                    test: Some(tc),
                    summary: None,
                    message: None,
                },
            );
        }
        let summary = TestRunSummary {
            passed: p,
            failed: f,
            skipped: s,
            total: p + f + s,
        };
        emit_event(
            app,
            TestResultEvent {
                event_type: "complete".into(),
                framework: framework.into(),
                test: None,
                summary: Some(summary.clone()),
                message: None,
            },
        );
        return Ok(summary);
    }
    let parsed: JestStyleResult = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut skipped = 0u32;

    for suite in &parsed.test_results {
        let suite_name = suite
            .assertion_results
            .first()
            .and_then(|a| a.ancestor_titles.first())
            .cloned()
            .unwrap_or_else(|| suite.name.clone());

        for assertion in &suite.assertion_results {
            let status = map_assertion_status(&assertion.status);
            if status == "passed" {
                passed += 1;
            } else if status == "failed" {
                failed += 1;
            } else {
                skipped += 1;
            }

            let test = TestCaseResult {
                id: format!("{}::{}", suite.name, assertion.full_name),
                name: if assertion.title.is_empty() {
                    assertion.full_name.clone()
                } else {
                    assertion.title.clone()
                },
                file: suite.name.clone(),
                suite: suite_name.clone(),
                status: status.clone(),
                duration_ms: assertion.duration,
                error: assertion.failure_messages.first().cloned(),
            };

            emit_event(
                app,
                TestResultEvent {
                    event_type: "test".to_string(),
                    framework: framework.to_string(),
                    test: Some(test),
                    summary: None,
                    message: None,
                },
            );
        }
    }

    let summary = TestRunSummary {
        passed: if parsed.num_passed_tests > 0 {
            parsed.num_passed_tests
        } else {
            passed
        },
        failed: if parsed.num_failed_tests > 0 {
            parsed.num_failed_tests
        } else {
            failed
        },
        skipped: if parsed.num_pending_tests > 0 {
            parsed.num_pending_tests
        } else {
            skipped
        },
        total: if parsed.num_total_tests > 0 {
            parsed.num_total_tests
        } else {
            passed + failed + skipped
        },
    };

    emit_event(
        app,
        TestResultEvent {
            event_type: "complete".to_string(),
            framework: framework.to_string(),
            test: None,
            summary: Some(summary.clone()),
            message: None,
        },
    );

    Ok(summary)
}

fn parse_text_runner_output(
    fw: &str,
    stdout: &str,
    stderr: &str,
) -> (Vec<TestCaseResult>, TestRunSummary) {
    let (mut tests, mut p, mut f, mut s) = (Vec::new(), 0u32, 0u32, 0u32);
    for l in format!("{stdout}\n{stderr}").lines().map(str::trim) {
        let x = if fw == "cargo" {
            l.strip_prefix("test ")
                .and_then(|r| r.rsplit_once(" ... "))
                .and_then(|(n, st)| {
                    Some((
                        format!("cargo::{n}"),
                        n,
                        n.rsplit_once("::").map(|(a, _)| a).unwrap_or("cargo"),
                        match st.trim() {
                            "ok" => "passed",
                            "FAILED" => "failed",
                            "ignored" => "skipped",
                            _ => return None,
                        },
                    ))
                })
        } else if fw == "pytest" && l.contains("::") {
            let mut it = l.split_whitespace();
            it.next().zip(it.next()).and_then(|(nd, v)| {
                let (fl, n) = nd.split_once("::").unwrap_or((nd, nd));
                Some((
                    nd.into(),
                    n,
                    fl,
                    match v {
                        "PASSED" | "XPASS" => "passed",
                        "FAILED" | "ERROR" => "failed",
                        "SKIPPED" | "XFAIL" => "skipped",
                        _ => return None,
                    },
                ))
            })
        } else if fw == "go" {
            [
                ("--- PASS: ", "passed"),
                ("--- FAIL: ", "failed"),
                ("--- SKIP: ", "skipped"),
            ]
            .into_iter()
            .find_map(|(px, st)| {
                l.strip_prefix(px).map(|r| {
                    let n = r.split_whitespace().next().unwrap_or(r);
                    (format!("go::{n}"), n, "go", st)
                })
            })
        } else {
            None
        };
        if let Some((id, n, su, st)) = x {
            match st {
                "passed" => p += 1,
                "failed" => f += 1,
                _ => s += 1,
            }
            tests.push(TestCaseResult {
                id,
                name: n.into(),
                file: su.into(),
                suite: su.into(),
                status: st.into(),
                duration_ms: None,
                error: None,
            });
        }
    }
    (
        tests,
        TestRunSummary {
            passed: p,
            failed: f,
            skipped: s,
            total: p + f + s,
        },
    )
}

pub async fn run_tests(
    app: AppHandle,
    project_path: String,
    framework: String,
    pattern: Option<String>,
) -> Result<TestRunSummary, String> {
    use tauri::Manager;
    if app
        .try_state::<crate::core::workspace_trust::WorkspaceTrustState>()
        .map(|t| !t.is_trusted(&project_path))
        .unwrap_or(true)
    {
        return Err("Workspace is not trusted.".into());
    }
    let output_file = std::env::temp_dir().join(format!("bettershape-test-{}.json", uuid_like()));

    emit_event(
        &app,
        TestResultEvent {
            event_type: "start".to_string(),
            framework: framework.clone(),
            test: None,
            summary: None,
            message: pattern.clone(),
        },
    );

    let framework_lower = framework.to_lowercase();
    if matches!(framework_lower.as_str(), "cargo" | "pytest" | "go") {
        let (bin, base): (&str, &[&str]) = match framework_lower.as_str() {
            "cargo" => ("cargo", &["test", "--color=never"]),
            "pytest" => ("pytest", &["-v", "--tb=short", "--color=no"]),
            _ => ("go", &["test", "-v", "./..."]),
        };
        let mut cmd = Command::new(bin);
        cmd.args(base);
        if framework_lower == "cargo"
            && !Path::new(&project_path).join("Cargo.toml").exists()
            && Path::new(&project_path)
                .join("src-tauri/Cargo.toml")
                .exists()
        {
            cmd.args(["--manifest-path", "src-tauri/Cargo.toml"]);
        }
        if let Some(p) = pattern.as_deref().filter(|p| !p.is_empty()) {
            match framework_lower.as_str() {
                "pytest" => {
                    cmd.args(["-k", p]);
                }
                "go" => {
                    cmd.args(["-run", p]);
                }
                "cargo" if p.starts_with('-') => return Err("Bad pattern.".into()),
                _ => {
                    cmd.arg(p);
                }
            }
        }
        cmd.current_dir(&project_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::core::process::hide_console(&mut cmd);
        let out = tokio::task::spawn_blocking(move || cmd.output())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Failed: {e}"))?;
        let (so, se) = (
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
        let (cases, sum) = parse_text_runner_output(&framework_lower, &so, &se);
        for tc in cases {
            emit_event(
                &app,
                TestResultEvent {
                    event_type: "test".into(),
                    framework: framework.clone(),
                    test: Some(tc),
                    summary: None,
                    message: None,
                },
            );
        }
        if !out.status.success()
            || (sum.total == 0 && pattern.as_deref().is_some_and(|p| !p.is_empty()))
        {
            let m = if !out.status.success() {
                if !se.trim().is_empty() {
                    se.to_string()
                } else {
                    so.to_string()
                }
            } else {
                "No tests matched.".into()
            };
            emit_event(
                &app,
                TestResultEvent {
                    event_type: "error".into(),
                    framework,
                    test: None,
                    summary: Some(sum),
                    message: Some(m.clone()),
                },
            );
            return Err(m);
        }
        emit_event(
            &app,
            TestResultEvent {
                event_type: "complete".into(),
                framework,
                test: None,
                summary: Some(sum.clone()),
                message: None,
            },
        );
        return Ok(sum);
    }

    let mut cmd = Command::new(npm_command());
    cmd.current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::core::process::hide_console(&mut cmd);

    if framework_lower == "vitest" {
        cmd.arg("--yes")
            .arg("vitest")
            .arg("run")
            .arg("--reporter=json")
            .arg("--outputFile")
            .arg(&output_file);
        if let Some(p) = &pattern {
            if !p.is_empty() {
                cmd.arg(p);
            }
        }
    } else if framework_lower == "jest" {
        cmd.arg("--yes")
            .arg("jest")
            .arg("--json")
            .arg("--outputFile")
            .arg(&output_file)
            .arg("--testLocationInResults");
        if let Some(p) = &pattern {
            if !p.is_empty() {
                cmd.arg("--testPathPattern").arg(p);
            }
        }
    } else if framework_lower == "playwright" {
        cmd.args(["--yes", "playwright", "test", "--reporter=json"])
            .env("PLAYWRIGHT_JSON_OUTPUT_NAME", &output_file);
        if let Some(p) = pattern.as_deref().filter(|p| !p.is_empty()) {
            cmd.arg(p);
        }
    } else {
        return Err(format!("Unsupported test framework: {framework}"));
    }

    let output = tokio::task::spawn_blocking(move || cmd.output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Failed to run tests: {e}"))?;

    if !output_file.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = if !stderr.trim().is_empty() {
            stderr.to_string()
        } else {
            stdout.to_string()
        };
        emit_event(
            &app,
            TestResultEvent {
                event_type: "error".to_string(),
                framework: framework.clone(),
                test: None,
                summary: None,
                message: Some(message.clone()),
            },
        );
        return Err(message);
    }

    let summary = parse_and_emit_results(&app, &framework, &output_file)?;
    let _ = std::fs::remove_file(&output_file);
    Ok(summary)
}

fn uuid_like() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parsers() {
        let pkg: PackageJson =
            serde_json::from_str(r#"{"devDependencies":{"vitest":"^4.0.0"}}"#).unwrap();
        let ((_, c), (_, p), (_, g)) = (
            parse_text_runner_output(
                "cargo",
                "test a ... ok\ntest b ... FAILED\ntest c ... ignored\n",
                "",
            ),
            parse_text_runner_output("pytest", "t/a.py::t1 PASSED\nt/a.py::t2 FAILED\n", ""),
            parse_text_runner_output("go", "--- PASS: A (0s)\n--- SKIP: B (0s)\n", ""),
        );
        assert!(
            detect_framework(Path::new("."), &pkg) == TestFramework::Vitest
                && (
                    c.passed, c.failed, c.skipped, c.total, p.passed, p.failed, g.passed, g.skipped
                ) == (1, 1, 1, 3, 1, 1, 1, 1)
        );
    }
}
