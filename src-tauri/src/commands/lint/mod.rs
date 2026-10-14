use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LintDiagnostic {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub message: String,
    pub severity: String,
    pub rule_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EslintLintResult {
    pub diagnostics: Vec<LintDiagnostic>,
    pub content: Option<String>,
    /// Set when ESLint produced nothing parseable, so the caller can say "we could not tell"
    /// instead of "there are no problems".
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EslintFileResult {
    #[serde(default)]
    messages: Vec<EslintMessage>,
}

#[derive(Debug, Deserialize)]
struct EslintMessage {
    #[serde(default)]
    line: u32,
    #[serde(default)]
    column: u32,
    #[serde(default, rename = "endLine")]
    end_line: u32,
    #[serde(default, rename = "endColumn")]
    end_column: u32,
    #[serde(default)]
    message: String,
    #[serde(default)]
    severity: u8,
    #[serde(default, rename = "ruleId")]
    rule_id: Option<String>,
}

fn npx_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "npx.cmd"
    } else {
        "npx"
    }
}

fn write_temp_file(file_path: &str, content: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("txt");
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("lint");
    let ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect();
    let stem: String = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        .take(48)
        .collect();
    let (ext, stem) = (
        if ext.is_empty() { "txt" } else { &ext },
        if stem.is_empty() { "lint" } else { &stem },
    );
    let temp_dir = std::env::temp_dir().join("bettershape-lint");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!("{}-{}.{}", stem, uuid_like(), ext));
    std::fs::write(&temp_path, content).map_err(|e| e.to_string())?;
    Ok(temp_path)
}

fn uuid_like() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// `None` means the output was not parseable ESLint JSON at all.
///
/// That is deliberately not the same as "no problems". ESLint writes nothing to stdout when
/// it cannot run -- no local install, a broken flat config, an untrusted workspace -- and an
/// empty list here would tell the user their code is clean when nothing was checked.
fn parse_eslint_json(stdout: &str) -> Option<Vec<LintDiagnostic>> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }

    let files: Vec<EslintFileResult> = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => match serde_json::from_str::<EslintFileResult>(trimmed) {
            Ok(single) => vec![single],
            Err(_) => return None,
        },
    };

    let mut diagnostics = Vec::new();
    for file in files {
        for msg in file.messages {
            let severity = match msg.severity {
                2 => "error",
                1 => "warning",
                _ => "info",
            };
            diagnostics.push(LintDiagnostic {
                line: msg.line.max(1),
                column: msg.column.max(1),
                end_line: if msg.end_line == 0 {
                    msg.line.max(1)
                } else {
                    msg.end_line
                },
                end_column: if msg.end_column == 0 {
                    msg.column.max(1)
                } else {
                    msg.end_column
                },
                message: msg.message,
                severity: severity.to_string(),
                rule_id: msg.rule_id,
            });
        }
    }
    Some(diagnostics)
}

/// Why a run produced no usable output, phrased for the person reading it.
///
/// ESLint exits 0 when it found nothing and 1 when it found problems -- the JSON is on stdout
/// either way -- so a non-zero status is not on its own a failure. Only unparseable output is.
fn eslint_failure_reason(output: &std::process::Output, stdout: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let first_line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if !first_line.is_empty() {
        return format!("ESLint could not run: {first_line}");
    }
    if !output.status.success() {
        return format!("ESLint exited with {}", output.status);
    }
    if stdout.trim().is_empty() {
        return "ESLint produced no output. It may not be installed for this project.".to_string();
    }
    "ESLint output could not be parsed.".to_string()
}

pub fn eslint_lint_file(
    project_path: String,
    file_path: String,
    content: String,
    apply_fix: bool,
) -> Result<EslintLintResult, String> {
    let temp_path = write_temp_file(&file_path, &content)?;
    let temp_display = temp_path.to_string_lossy().to_string();

    let mut cmd = Command::new(npx_command());
    cmd.current_dir(&project_path)
        .arg("--no-install")
        .arg("eslint")
        .arg("--format")
        .arg("json")
        .arg("--no-error-on-unmatched-pattern");
    crate::core::process::apply_trusted_binary_env(&mut cmd);
    crate::core::process::hide_console(&mut cmd);

    if apply_fix {
        cmd.arg("--fix");
    }

    cmd.arg(&temp_display);

    let output = cmd.output().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to run eslint: {e}")
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_eslint_json(&stdout);
    let diagnostics = parsed.clone().unwrap_or_default();
    let error = parsed.is_none().then(|| eslint_failure_reason(&output, &stdout));

    let fixed_content = if apply_fix {
        std::fs::read_to_string(&temp_path).ok()
    } else {
        None
    };

    let _ = std::fs::remove_file(&temp_path);

    Ok(EslintLintResult {
        diagnostics,
        content: fixed_content,
        error,
    })
}

pub fn prettier_format_file(
    project_path: String,
    file_path: String,
    content: String,
) -> Result<String, String> {
    let mut cmd = Command::new(npx_command());
    cmd.current_dir(&project_path)
        .arg("--no-install")
        .arg("prettier")
        .arg("--stdin-filepath")
        .arg(&file_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::core::process::apply_trusted_binary_env(&mut cmd);
    crate::core::process::hide_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run prettier: {e}"))?;

    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write to prettier stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read prettier output: {e}"))?;

    if output.status.success() {
        let formatted = String::from_utf8_lossy(&output.stdout).to_string();
        return Ok(if formatted.is_empty() {
            content
        } else {
            formatted
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("Prettier failed: {stderr}"))
}
