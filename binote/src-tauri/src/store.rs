use crate::asr::AsrProvider;
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";
const NOTES_FILE: &str = "notes.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// ASR 提供商选择
    #[serde(default)]
    pub asr_provider: AsrProvider,
    /// DashScope API Key
    pub asr_api_key: Option<String>,
    /// SenseVoice API Key (硅基流动)
    pub sensevoice_api_key: Option<String>,
    pub llm_api_key: Option<String>,
    pub llm_base_url: Option<String>,
    pub llm_model: Option<String>,
    /// B站 SESSDATA Cookie（用于获取字幕）
    pub bilibili_sessdata: Option<String>,
    /// B站 bili_jct（CSRF token，扫码登录自动获取，用于 Cookie 刷新）
    #[serde(default)]
    pub bilibili_bili_jct: Option<String>,
    /// B站 refresh_token（扫码登录自动获取，用于 Cookie 刷新）
    #[serde(default)]
    pub bilibili_refresh_token: Option<String>,
    /// B站 DedeUserID
    #[serde(default)]
    pub bilibili_dede_user_id: Option<String>,
    /// Cookie 获取时间戳（用于判断是否需要刷新）
    #[serde(default)]
    pub bilibili_cookie_ts: Option<i64>,
    /// 转录完成后是否自动生成 AI 总结（默认开启，保持旧行为）
    #[serde(default = "default_true")]
    pub auto_summary: bool,
    /// 转录完成后是否自动生成思维导图（默认开启，保持旧行为）
    #[serde(default = "default_true")]
    pub auto_mindmap: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            asr_provider: AsrProvider::default(),
            asr_api_key: None,
            sensevoice_api_key: None,
            llm_api_key: None,
            llm_base_url: None,
            llm_model: None,
            bilibili_sessdata: None,
            bilibili_bili_jct: None,
            bilibili_refresh_token: None,
            bilibili_dede_user_id: None,
            bilibili_cookie_ts: None,
            auto_summary: true,
            auto_mindmap: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub transcript: String,
    pub summary: Option<String>,
    pub mindmap: Option<String>,
    pub created_at: i64,
    /// 转录来源: "subtitle" | "asr" | "mixed"，旧数据为 None
    #[serde(default)]
    pub transcript_source: Option<String>,
    /// 未使用原生字幕或部分回退 ASR 的原因说明，旧数据为 None
    #[serde(default)]
    pub transcript_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct NotesStore {
    notes: Vec<Note>,
}

pub struct Store {
    app_dir: PathBuf,
}

impl Store {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::StoreError(e.to_string()))?;

        std::fs::create_dir_all(&app_dir).map_err(|e| AppError::StoreError(e.to_string()))?;

        Ok(Self { app_dir })
    }

    pub fn load_config(&self) -> Result<AppConfig> {
        let path = self.app_dir.join(CONFIG_FILE);
        if !path.exists() {
            return Ok(AppConfig::default());
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| AppError::StoreError(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| AppError::StoreError(e.to_string()))
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<()> {
        let path = self.app_dir.join(CONFIG_FILE);
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| AppError::StoreError(e.to_string()))?;
        std::fs::write(&path, content).map_err(|e| AppError::StoreError(e.to_string()))
    }

    pub fn load_notes(&self) -> Result<Vec<Note>> {
        let path = self.app_dir.join(NOTES_FILE);
        if !path.exists() {
            return Ok(vec![]);
        }
        let content =
            std::fs::read_to_string(&path).map_err(|e| AppError::StoreError(e.to_string()))?;
        let store: NotesStore =
            serde_json::from_str(&content).map_err(|e| AppError::StoreError(e.to_string()))?;
        Ok(store.notes)
    }

    pub fn save_note(&self, note: Note) -> Result<()> {
        let mut notes = self.load_notes()?;
        if let Some(pos) = notes.iter().position(|n| n.id == note.id) {
            notes[pos] = note;
        } else {
            notes.insert(0, note);
        }
        self.save_notes(&notes)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let mut notes = self.load_notes()?;
        notes.retain(|n| n.id != id);
        self.save_notes(&notes)
    }

    fn save_notes(&self, notes: &[Note]) -> Result<()> {
        let path = self.app_dir.join(NOTES_FILE);
        let store = NotesStore {
            notes: notes.to_vec(),
        };
        let content = serde_json::to_string_pretty(&store)
            .map_err(|e| AppError::StoreError(e.to_string()))?;
        std::fs::write(&path, content).map_err(|e| AppError::StoreError(e.to_string()))
    }
}
