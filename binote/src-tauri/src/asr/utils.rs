use reqwest::Client;
use std::time::Duration;

/// 创建配置好的 HTTP 客户端
pub fn create_http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| Client::new())
}

/// 去除末尾标点符号
pub fn strip_trailing_punctuation(text: &mut String) {
    let punctuation = ['。', '！', '？', '，', '.', '!', '?', ','];
    while text
        .chars()
        .last()
        .map_or(false, |c| punctuation.contains(&c))
    {
        text.pop();
    }
}
