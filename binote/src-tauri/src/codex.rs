use crate::connection_test::ConnectionTestResult;
use crate::error::{AppError, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

const GENERATE_TIMEOUT: Duration = Duration::from_secs(180);
const TEST_TIMEOUT: Duration = Duration::from_secs(60);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10);
const AUTH_STORE_CONFIG: &str = "cli_auth_credentials_store=\"auto\"";
const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES: usize = 16 * 1024;
const PROBE: &str = "BINOTE_OK";

pub fn supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

fn failure(message: impl Into<String>) -> AppError {
    AppError::LlmError(message.into())
}

/// 不把原始 stderr / 协议错误传给 UI，避免输出登录凭据或用户文本。
fn friendly_error(detail: &str) -> &'static str {
    let text = detail.to_lowercase();
    if [
        "usage limit",
        "insufficient_quota",
        "quota exceeded",
        "credits",
        "额度",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "Codex 订阅额度已用尽，请等待恢复后重试"
    } else if ["rate limit", "too many requests", "429"]
        .iter()
        .any(|s| text.contains(s))
    {
        "Codex 当前被限流，请稍后重试"
    } else if [
        "unauthorized",
        "not logged",
        "not authenticated",
        "login",
        "authentication",
        "401",
        "api key",
        "chatgpt authentication",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "Codex 未使用有效的 ChatGPT 登录，请先在终端执行 codex login，再重试"
    } else if [
        "unexpected argument",
        "unknown flag",
        "unrecognized",
        "unknown feature",
        "unsupported option",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "本机 Codex 版本不支持所需参数，请更新 Codex CLI 后重试"
    } else if [
        "network",
        "connection",
        "timed out",
        "timeout",
        "dns",
        "tls",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "Codex 网络连接失败，请检查网络后重试"
    } else if text.contains("model")
        || text.contains("service tier")
        || text.contains("service_tier")
        || text.contains("403")
    {
        "当前模型或速度不可用，请核对模型名称、账户权限，或关闭 Fast 后重试"
    } else {
        "Codex 执行失败，请检查本机 Codex 登录和运行状态后重试"
    }
}

#[derive(Clone, Default)]
struct CodexOutput {
    answer: String,
    completed: bool,
    error: Option<String>,
}

impl CodexOutput {
    fn push(&mut self, line: &str) -> Result<()> {
        let event: Value = serde_json::from_str(line)
            .map_err(|_| failure("Codex 返回了无法解析的结果，请更新 Codex CLI 后重试"))?;
        match event["type"].as_str() {
            Some("item.completed") => {
                let item = &event["item"];
                if item["type"] == "agent_message" && item["phase"] != "commentary" {
                    if let Some(text) = item["text"].as_str() {
                        self.answer = text.to_owned();
                    }
                }
            }
            Some("turn.completed") => self.completed = true,
            Some("turn.failed" | "error") => {
                let detail = event["error"]["message"]
                    .as_str()
                    .or_else(|| event["message"].as_str())
                    .unwrap_or("");
                self.error = Some(friendly_error(detail).into());
            }
            // 新增事件和推理内容不会混入笔记。
            _ => {}
        }
        Ok(())
    }

    fn finish(self, success: bool) -> Result<String> {
        if let Some(error) = self.error {
            return Err(failure(error));
        }
        if !success {
            return Err(failure("Codex 进程异常退出，请检查本机 Codex 状态后重试"));
        }
        if !self.completed || self.answer.trim().is_empty() {
            return Err(failure("Codex 未返回完整有效的结果，请重试"));
        }
        Ok(self.answer.trim().to_owned())
    }
}

async fn read_output(
    reader: impl AsyncRead + Unpin,
    on_progress: impl Fn(usize),
) -> Result<CodexOutput> {
    let mut reader = BufReader::new(reader);
    let mut output = CodexOutput::default();
    let mut total = 0;
    loop {
        let mut line = Vec::new();
        let size = (&mut reader)
            .take((MAX_EVENT_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| failure("读取 Codex 输出失败"))?;
        if size == 0 {
            break;
        }
        total += size;
        if size > MAX_EVENT_BYTES || total > MAX_OUTPUT_BYTES {
            return Err(failure("Codex 返回结果过大，请缩短内容后重试"));
        }
        let text = std::str::from_utf8(&line).map_err(|_| failure("Codex 返回了无效文本编码"))?;
        if !text.trim().is_empty() {
            output.push(text)?;
            if !output.answer.is_empty() {
                on_progress(output.answer.chars().count());
            }
        }
    }
    Ok(output)
}

async fn read_diagnostics(mut reader: impl AsyncRead + Unpin) -> Result<String> {
    let mut tail = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let size = reader
            .read(&mut buf)
            .await
            .map_err(|_| failure("读取 Codex 运行状态失败"))?;
        if size == 0 {
            break;
        }
        tail.extend_from_slice(&buf[..size]);
        if tail.len() > MAX_DIAGNOSTIC_BYTES {
            tail.drain(..tail.len() - MAX_DIAGNOSTIC_BYTES);
        }
    }
    Ok(String::from_utf8_lossy(&tail).into_owned())
}

fn native_executable(path: &Path) -> Option<PathBuf> {
    use std::io::Read;
    let resolved = path.canonicalize().ok()?;
    let mut header = [0; 4];
    std::fs::File::open(&resolved)
        .ok()?
        .read_exact(&mut header)
        .ok()?;
    let native = if cfg!(target_os = "windows") {
        header[..2] == *b"MZ"
    } else {
        matches!(
            header,
            [0xcf, 0xfa, 0xed, 0xfe]
                | [0xfe, 0xed, 0xfa, 0xcf]
                | [0xca, 0xfe, 0xba, 0xbe]
                | [0xca, 0xfe, 0xba, 0xbf]
        )
    };
    native.then_some(resolved)
}

/// npm 的启动器依赖 Node；直接定位它随包分发的原生程序。
fn npm_executable(package: &Path) -> Option<PathBuf> {
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let cpu = if arch == "arm64" { "aarch64" } else { "x86_64" };
    let (platform, target, binary) = if cfg!(target_os = "windows") {
        ("win32", format!("{cpu}-pc-windows-msvc"), "codex.exe")
    } else {
        ("darwin", format!("{cpu}-apple-darwin"), "codex")
    };
    let platform_package = format!("codex-{platform}-{arch}");
    let roots = [
        package.join("vendor"),
        package
            .join("node_modules/@openai")
            .join(&platform_package)
            .join("vendor"),
        package.parent()?.join(platform_package).join("vendor"),
    ];
    for root in roots {
        for folder in ["bin", "codex"] {
            if let Some(exe) = native_executable(&root.join(&target).join(folder).join(binary)) {
                return Some(exe);
            }
        }
    }
    None
}

fn resolve_entry(path: &Path) -> Option<PathBuf> {
    if let Some(exe) = native_executable(path) {
        return Some(exe);
    }
    let canonical = path.canonicalize().ok()?;
    // npm / Homebrew 的符号链接可能指向 @openai/codex/bin/codex.js。
    if canonical.file_name()?.to_str()? == "codex.js" {
        return npm_executable(canonical.parent()?.parent()?);
    }
    let name = path.file_name()?.to_str()?;
    if matches!(name, "codex.cmd" | "codex.ps1" | "codex") {
        return npm_executable(&path.parent()?.join("node_modules/@openai/codex"));
    }
    None
}

fn resolve_executable(custom: Option<&str>) -> Result<PathBuf> {
    if !supported() {
        return Err(failure("Codex 仅支持 Windows 和 macOS 桌面端"));
    }
    if let Some(path) = custom.filter(|p| !p.trim().is_empty()) {
        return resolve_entry(Path::new(path.trim()))
            .ok_or_else(|| failure("Codex 路径无效，请填写已安装的 Codex 可执行文件路径"));
    }
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(appdata).join("npm"));
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    for dir in directories {
        for name in ["codex.exe", "codex", "codex.cmd"] {
            if let Some(exe) = resolve_entry(&dir.join(name)) {
                return Ok(exe);
            }
        }
    }
    Err(failure(
        "未找到 Codex CLI，请先安装 Codex，或在高级选项中填写程序路径",
    ))
}

/// 取消 future 时同步交还子进程给清理线程，避免阻塞异步运行时。
struct ManagedChild(Option<Child>);

impl Drop for ManagedChild {
    fn drop(&mut self) {
        let Some(mut child) = self.0.take() else {
            return;
        };
        let Some(pid) = child.id() else {
            return;
        };
        std::thread::spawn(move || {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                // 只清理本次创建的原生进程树，不按进程名结束其他 Codex。
                let system_root =
                    std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
                let _ = std::process::Command::new(
                    PathBuf::from(system_root).join("System32/taskkill.exe"),
                )
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            }
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("/bin/kill")
                    .args(["-TERM", "--", &format!("-{pid}")])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let _ = pid;
            let _ = child.start_kill();
        });
    }
}

#[derive(Clone)]
pub struct CodexClient {
    model: String,
    executable: Option<String>,
    fast: bool,
    work_dir: PathBuf,
}

impl CodexClient {
    pub fn new(
        model: String,
        executable: Option<String>,
        fast: bool,
        work_dir: PathBuf,
    ) -> Result<Self> {
        if !supported() {
            return Err(failure("Codex 仅支持 Windows 和 macOS 桌面端"));
        }
        let model = model.trim().to_owned();
        if model.is_empty() || model.len() > 200 || model.chars().any(char::is_whitespace) {
            return Err(failure("请填写有效的 Codex 模型名称（不含空格）"));
        }
        Ok(Self {
            model,
            executable,
            fast,
            work_dir,
        })
    }

    fn command(&self, executable: &Path) -> Command {
        let mut command = self.process_command(executable);
        command.args([
            "--no-daemon",
            "exec",
            "--json",
            "--ephemeral",
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--color",
            "never",
            "--sandbox",
            "read-only",
            "--model",
            &self.model,
        ]);
        for config in [
            AUTH_STORE_CONFIG,
            "model_provider=\"openai\"",
            "forced_login_method=\"chatgpt\"",
            "project_doc_max_bytes=0",
            "web_search=\"disabled\"",
            "model_reasoning_effort=\"low\"",
            "features.shell_tool=false",
            "features.unified_exec=false",
            "features.hooks=false",
            "features.multi_agent=false",
            "features.apps=false",
            "features.plugins=false",
        ] {
            command.args(["-c", config]);
        }
        command.args([
            "-c",
            if self.fast {
                "service_tier=\"fast\""
            } else {
                "service_tier=\"default\""
            },
        ]);
        command.arg("-");
        command
    }

    fn process_command(&self, executable: &Path) -> Command {
        let mut command = Command::new(executable);
        command
            .current_dir(&self.work_dir)
            .env_remove("CODEX_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("OPENAI_BASE_URL")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        command
    }

    async fn ensure_chatgpt_login(&self, executable: &Path) -> Result<()> {
        let operation = async {
            // 不使用 forced_login_method：认证不匹配时该参数会注销本机登录。
            // 先只读检查，再允许正式执行器使用 ChatGPT 认证约束。
            let mut command = self.process_command(executable);
            command.args(["--no-daemon", "login", "status", "-c", AUTH_STORE_CONFIG]);
            command.stdin(Stdio::null());
            let child = command
                .spawn()
                .map_err(|_| failure("无法启动 Codex，请检查程序路径与执行权限"))?;
            let mut guard = ManagedChild(Some(child));
            let child = guard
                .0
                .as_mut()
                .ok_or_else(|| failure("Codex 进程未启动"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| failure("无法检查 Codex 登录状态"))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| failure("无法检查 Codex 登录状态"))?;
            let (stdout, stderr, status) = tokio::join!(
                read_diagnostics(stdout),
                read_diagnostics(stderr),
                child.wait()
            );
            let success = status
                .map_err(|_| failure("无法检查 Codex 登录状态"))?
                .success();
            // 状态可能含 API Key 片段；只判断固定标记，不记录或返回原文。
            check_chatgpt_login(success, &stdout?, &stderr?)
        };
        tokio::time::timeout(LOGIN_TIMEOUT, operation)
            .await
            .map_err(|_| failure("检查 Codex 登录超时，请在终端执行 codex login 后重试"))?
    }

    async fn execute(
        &self,
        prompt: &str,
        limit: Duration,
        on_progress: impl Fn(usize),
    ) -> Result<String> {
        let executable = resolve_executable(self.executable.as_deref())?;
        tokio::fs::create_dir_all(&self.work_dir)
            .await
            .map_err(|_| failure("无法创建 Codex 工作目录"))?;
        tokio::time::timeout(limit, async {
            self.ensure_chatgpt_login(&executable).await?;
            run_command(self.command(&executable), prompt, limit, on_progress).await
        })
        .await
        .map_err(|_| failure("Codex 请求超时，请检查网络，或缩短内容后重试"))?
    }

    pub async fn generate(&self, prompt: &str, on_progress: impl Fn(usize)) -> Result<String> {
        self.execute(prompt, GENERATE_TIMEOUT, on_progress).await
    }

    pub async fn test_connection(&self) -> ConnectionTestResult {
        let started = Instant::now();
        let result = self
            .execute(
                "仅回复 BINOTE_OK，不要解释，不要调用任何工具。",
                TEST_TIMEOUT,
                |_| {},
            )
            .await;
        let latency = started.elapsed().as_millis() as u64;
        match result {
            Ok(text) if probe_succeeded(&text) => ConnectionTestResult::success(
                format!("Codex 调用成功 · 模型 {} · {}ms", self.model, latency),
                latency,
            ),
            Ok(_) => ConnectionTestResult::error(
                "Codex 已返回回复，但未通过验证，请检查模型或重试",
                latency,
            ),
            Err(error) => {
                let message = error.to_string();
                let limited = message.contains("额度") || message.contains("限流");
                ConnectionTestResult {
                    ok: false,
                    severity: if limited { "warning" } else { "error" }.into(),
                    message,
                    latency_ms: latency,
                }
            }
        }
    }
}

fn check_chatgpt_login(success: bool, stdout: &str, stderr: &str) -> Result<()> {
    let chatgpt = stdout
        .lines()
        .chain(stderr.lines())
        .any(|line| line.trim() == "Logged in using ChatGPT");
    if success && chatgpt {
        Ok(())
    } else {
        Err(failure(
            "未确认 Codex 的 ChatGPT 登录，请先在终端执行 codex login，再重试",
        ))
    }
}

async fn run_command(
    mut command: Command,
    prompt: &str,
    limit: Duration,
    on_progress: impl Fn(usize),
) -> Result<String> {
    let operation = async {
        let child = command
            .spawn()
            .map_err(|_| failure("无法启动 Codex，请检查程序路径与执行权限"))?;
        let mut guard = ManagedChild(Some(child));
        let child = guard
            .0
            .as_mut()
            .ok_or_else(|| failure("Codex 进程未启动"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| failure("无法向 Codex 发送内容"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure("无法读取 Codex 结果"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| failure("无法读取 Codex 状态"))?;
        let write_input = async {
            // 以 stdin 传递内容，避免命令行长度限制及命令注入。
            let result = stdin.write_all(prompt.as_bytes()).await;
            drop(stdin);
            result
        };
        let (written, output, diagnostics, status) = tokio::join!(
            write_input,
            read_output(stdout, on_progress),
            read_diagnostics(stderr),
            child.wait()
        );
        let status = status.map_err(|_| failure("无法获取 Codex 结束状态"))?;
        // 协议中的失败原因比 stderr 中的运行日志更准确；两者均只返回固定分类。
        if let Ok(parsed) = &output {
            if let Some(error) = &parsed.error {
                return Err(failure(error.clone()));
            }
        }
        if !status.success() {
            return Err(failure(friendly_error(&diagnostics?)));
        }
        written.map_err(|_| failure("向 Codex 发送内容失败"))?;
        diagnostics?;
        output?.finish(true)
    };
    tokio::time::timeout(limit, operation)
        .await
        .map_err(|_| failure("Codex 请求超时，请检查网络，或缩短内容后重试"))?
}

fn probe_succeeded(text: &str) -> bool {
    text.trim() == PROBE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_completed_nonempty_output() {
        let mut output = CodexOutput::default();
        output
            .push(r#"{"type":"item.completed","item":{"type":"agent_message","text":"有效笔记"}}"#)
            .unwrap();
        assert!(output.clone().finish(true).is_err());
        output
            .push(r#"{"type":"turn.completed","usage":{"input_tokens":10}}"#)
            .unwrap();
        assert_eq!(output.clone().finish(true).unwrap(), "有效笔记");
        assert!(output.finish(false).is_err());
        assert!(CodexOutput {
            completed: true,
            ..Default::default()
        }
        .finish(true)
        .is_err());
    }

    #[test]
    fn ignores_progress_and_rejects_failed_turns() {
        let mut output = CodexOutput::default();
        output
            .push(r#"{"type":"item.completed","item":{"type":"reasoning","text":"推理内容"}}"#)
            .unwrap();
        output.push(r#"{"type":"item.completed","item":{"type":"agent_message","phase":"commentary","text":"准备处理"}}"#).unwrap();
        output
            .push(r#"{"type":"item.completed","item":{"type":"agent_message","text":"不应保存"}}"#)
            .unwrap();
        output.push(r#"{"type":"turn.failed","error":{"message":"model not found; secret=never-print"}}"#).unwrap();
        let error = output.finish(true).unwrap_err().to_string();
        assert!(error.contains("模型"));
        assert!(!error.contains("never-print"));
    }

    #[test]
    fn rejects_malformed_protocol_and_inexact_probe() {
        assert!(CodexOutput::default().push("invalid json").is_err());
        assert!(probe_succeeded(" BINOTE_OK\n"));
        assert!(!probe_succeeded("运行失败 BINOTE_OK"));
        assert!(!probe_succeeded(""));
    }

    #[test]
    fn login_check_accepts_only_chatgpt_and_never_echoes_credentials() {
        assert!(check_chatgpt_login(true, "", "Logged in using ChatGPT\n").is_ok());
        for (success, text) in [
            (true, "Logged in using an API key - sk-private"),
            (false, "Not logged in"),
            (true, "unknown output"),
            (false, "Logged in using ChatGPT"),
        ] {
            let error = check_chatgpt_login(success, text, "")
                .unwrap_err()
                .to_string();
            assert!(error.contains("codex login"));
            assert!(!error.contains("sk-private"));
        }
    }

    #[test]
    fn classifies_auth_model_quota_and_version_without_echoing_details() {
        assert!(friendly_error("401 Unauthorized access_token=secret").contains("登录"));
        assert!(friendly_error("model is not supported").contains("模型"));
        assert!(friendly_error("usage limit reached").contains("额度"));
        assert!(friendly_error("unexpected argument --ignore-user-config").contains("更新"));
        assert!(friendly_error("unexpected argument --model").contains("更新"));
        assert!(friendly_error("model stream connection failed").contains("网络"));
        assert!(!friendly_error("unknown secret payload").contains("payload"));
    }

    #[tokio::test]
    async fn bounds_protocol_and_diagnostic_output() {
        let oversized = vec![b'x'; MAX_EVENT_BYTES + 1];
        let error = read_output(&oversized[..], |_| {})
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("过大"));
        let diagnostics = vec![b'x'; MAX_DIAGNOSTIC_BYTES + 100];
        assert_eq!(
            read_diagnostics(&diagnostics[..]).await.unwrap().len(),
            MAX_DIAGNOSTIC_BYTES
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn fixture_command(script: &str) -> Command {
        #[cfg(target_os = "windows")]
        let mut command = {
            let system_root = std::env::var_os("SystemRoot").unwrap();
            let mut command = Command::new(
                PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
            );
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ]);
            command.creation_flags(0x08000000);
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            use std::os::unix::process::CommandExt;
            let mut command = Command::new("/bin/sh");
            command.args(["-c", script]);
            command.as_std_mut().process_group(0);
            command
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    async fn process_reads_stdin_and_rejects_nonzero_exit() {
        #[cfg(target_os = "windows")]
        let script = r#"$value = [Console]::In.ReadToEnd(); @{type='item.completed';item=@{type='agent_message';text=$value}} | ConvertTo-Json -Compress; '{"type":"turn.completed"}'"#;
        #[cfg(target_os = "macos")]
        let script = r#"value=$(cat); printf '{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}\n{"type":"turn.completed"}\n' "$value""#;
        let result = run_command(
            fixture_command(script),
            "BINOTE_STDIN",
            Duration::from_secs(10),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(result, "BINOTE_STDIN");
        let failed = format!("{script}; exit 1");
        assert!(run_command(
            fixture_command(&failed),
            "BINOTE_STDIN",
            Duration::from_secs(10),
            |_| {}
        )
        .await
        .is_err());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    async fn failed_event_preserves_safe_error_category_on_nonzero_exit() {
        #[cfg(target_os = "windows")]
        let script = r#"$null = [Console]::In.ReadToEnd(); '{"type":"turn.failed","error":{"message":"usage limit reached secret=hidden"}}'; [Console]::Error.WriteLine('generic error'); exit 1"#;
        #[cfg(target_os = "macos")]
        let script = r#"cat >/dev/null; printf '%s\n' '{"type":"turn.failed","error":{"message":"usage limit reached secret=hidden"}}'; printf generic >&2; exit 1"#;
        let error = run_command(
            fixture_command(script),
            "probe",
            Duration::from_secs(10),
            |_| {},
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("额度"));
        assert!(!error.contains("hidden"));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    async fn process_timeout_is_bounded() {
        #[cfg(target_os = "windows")]
        let script = "Start-Sleep -Seconds 30";
        #[cfg(target_os = "macos")]
        let script = "sleep 30";
        let started = Instant::now();
        let error = run_command(
            fixture_command(script),
            "probe",
            Duration::from_millis(100),
            |_| {},
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("超时"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    async fn dropping_process_guard_closes_child_and_descendant_pipes() {
        #[cfg(target_os = "windows")]
        let script = "& $PSHOME/powershell.exe -NoProfile -NonInteractive -Command 'Start-Sleep -Seconds 30'";
        #[cfg(target_os = "macos")]
        let script = "sleep 30";
        let mut child = fixture_command(script).spawn().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let guard = ManagedChild(Some(child));
        // 给夹具留出启动后代进程的时间；清理后所有写端都应关闭。
        tokio::time::sleep(Duration::from_millis(500)).await;
        drop(guard);
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stdout.read_to_end(&mut bytes))
            .await
            .expect("取消后进程树应退出")
            .unwrap();
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[test]
    fn command_uses_chatgpt_auth_and_isolates_api_environment() {
        let client =
            CodexClient::new("user-model".into(), None, false, std::env::temp_dir()).unwrap();
        let command = client.command(Path::new("codex"));
        let args: Vec<_> = command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"forced_login_method=\"chatgpt\"".to_string()));
        assert!(args.contains(&AUTH_STORE_CONFIG.to_string()));
        assert!(args.contains(&"service_tier=\"default\"".to_string()));
        assert_eq!(args.last().unwrap(), "-");
        for key in ["CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL"] {
            assert!(command
                .as_std()
                .get_envs()
                .any(|(name, value)| name == key && value.is_none()));
        }
    }
}
