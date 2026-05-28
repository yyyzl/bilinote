use reqwest::StatusCode;
use serde::Serialize;

/// 连通性测试结果
///
/// `severity` 用于前端区分展示样式：
/// - "ok"      → 成功（sage 绿色 chip）
/// - "warning" → 可达但受限（如 429，gold 黄色 chip）
/// - "error"   → 失败（red 红色 chip）
#[derive(Debug, Serialize, Clone)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub severity: String,
    pub message: String,
    pub latency_ms: u64,
}

impl ConnectionTestResult {
    pub fn success(message: impl Into<String>, latency_ms: u64) -> Self {
        Self {
            ok: true,
            severity: "ok".into(),
            message: message.into(),
            latency_ms,
        }
    }

    pub fn warning(message: impl Into<String>, latency_ms: u64) -> Self {
        Self {
            ok: true,
            severity: "warning".into(),
            message: message.into(),
            latency_ms,
        }
    }

    pub fn error(message: impl Into<String>, latency_ms: u64) -> Self {
        Self {
            ok: false,
            severity: "error".into(),
            message: message.into(),
            latency_ms,
        }
    }
}

/// 将 HTTP 状态码映射为人类可读的错误信息
///
/// `service_label` 用于错误信息中区分服务（例如 "LLM" / "DashScope"）
pub fn status_to_result(
    status: StatusCode,
    service_label: &str,
    latency_ms: u64,
    success_detail: Option<String>,
) -> ConnectionTestResult {
    if status.is_success() {
        let detail = success_detail.unwrap_or_else(|| "连通正常".into());
        return ConnectionTestResult::success(detail, latency_ms);
    }

    match status.as_u16() {
        401 | 403 => ConnectionTestResult::error("API Key 无效或权限不足", latency_ms),
        404 => ConnectionTestResult::error(
            format!("{} 接口未找到（请检查 Base URL 或 Model）", service_label),
            latency_ms,
        ),
        429 => ConnectionTestResult::warning(
            "服务可达，但当前被限流（Key 有效）",
            latency_ms,
        ),
        500..=599 => ConnectionTestResult::error(
            format!("服务端错误 ({})，请稍后再试", status.as_u16()),
            latency_ms,
        ),
        code => ConnectionTestResult::error(
            format!("{} 返回非预期状态码: {}", service_label, code),
            latency_ms,
        ),
    }
}

/// 将 reqwest 错误映射为可读信息
pub fn network_error_message(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时（网络不通或服务无响应）".into()
    } else if err.is_connect() {
        "无法建立连接（请检查 Base URL 是否正确）".into()
    } else if err.is_request() {
        format!("请求构造失败: {}", err)
    } else {
        format!("网络错误: {}", err)
    }
}
