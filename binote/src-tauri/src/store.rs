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
    /// 最大同时转录任务数（1-5，默认 2）。修改后需重启应用生效。
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_transcribe: usize,
}

fn default_true() -> bool {
    true
}

fn default_max_concurrent() -> usize {
    2
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
            max_concurrent_transcribe: 2,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub bvid: String,
    /// 用户提交的原始视频链接或输入，旧数据为 None
    #[serde(default)]
    pub source_url: Option<String>,
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
        atomic_write(&path, &content)
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

    /// 字段级原子更新：在单次调用内完成 load → 定位 → 就地改字段 → 写回。
    ///
    /// 调用方通过 `state.store.lock()` 持锁调用本方法，整个 read-modify-write
    /// 都在同一把锁内完成，避免"锁外 load、锁外耗时操作、再锁内整条覆盖"导致
    /// 并发对同一 note 的不同字段（如总结 / 思维导图）互相覆盖丢失。
    pub fn update_note<F>(&self, id: &str, f: F) -> Result<Note>
    where
        F: FnOnce(&mut Note),
    {
        let mut notes = self.load_notes()?;
        let pos = notes
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(|| AppError::StoreError("笔记不存在".into()))?;
        f(&mut notes[pos]);
        let updated = notes[pos].clone();
        self.save_notes(&notes)?;
        Ok(updated)
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
        atomic_write(&path, &content)
    }
}

/// 原子写：先写临时文件、fsync 落盘，再 rename 覆盖目标，
/// 避免写到一半进程崩溃导致目标文件被截断或残留半截数据。
/// 在 Windows 上 `std::fs::rename` 使用 MoveFileEx + REPLACE_EXISTING，可原子替换已存在文件。
/// 所有调用方都持有 `Mutex<Store>`，因此同一文件的临时名不会并发竞争。
fn atomic_write(path: &PathBuf, content: &str) -> Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    // 写临时文件并 fsync，确保数据真正落盘后再 rename（提升崩溃一致性）。
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| AppError::StoreError(e.to_string()))?;
        f.write_all(content.as_bytes())
            .map_err(|e| AppError::StoreError(e.to_string()))?;
        f.sync_all()
            .map_err(|e| AppError::StoreError(e.to_string()))?;
    }
    // rename 失败时尽量清理临时文件，避免残留垃圾。
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::StoreError(e.to_string()));
    }
    Ok(())
}
