# Database / Persistence Guidelines

> How data is persisted in this project.

---

## Overview

This project does **NOT** use a traditional database. Instead, it uses **JSON file persistence** for simplicity and portability. Data is stored as JSON files in the Tauri app data directory.

- **No ORM** — direct `serde_json` serialization/deserialization
- **No migrations** — schema changes are handled via `#[serde(default)]` annotations
- **Full-file read/write** — each operation reads and writes the entire file (not incremental)

---

## Storage Architecture

### Store Struct (`store.rs`)

```rust
pub struct Store {
    app_dir: PathBuf,  // Platform-specific app data directory
}
```

### File Locations

| File | Content | Platform Path |
|------|---------|---------------|
| `config.json` | User configuration (API keys, preferences) | `{app_data_dir}/config.json` |
| `notes.json` | All saved notes | `{app_data_dir}/notes.json` |

Platform-specific `app_data_dir`:
- **Windows**: `C:\Users\<user>\AppData\Roaming\<app-id>\`
- **macOS**: `/Users/<user>/Library/Application Support/<app-id>/`
- **Linux**: `~/.local/share/<app-id>/`
- **Android**: App-specific internal storage

### Data Models

```rust
// Configuration
pub struct AppConfig {
    #[serde(default)]
    pub asr_provider: AsrProvider,      // Default: DashScope
    pub asr_api_key: Option<String>,
    pub sensevoice_api_key: Option<String>,
    pub llm_api_key: Option<String>,
    pub llm_base_url: Option<String>,
    pub llm_model: Option<String>,
}

// Note
pub struct Note {
    pub id: String,              // UUID v4
    pub bvid: String,            // Bilibili video ID
    pub title: String,
    pub cover: String,           // Cover image URL
    pub transcript: String,      // ASR transcription result
    pub summary: Option<String>, // AI summary (Markdown)
    pub mindmap: Option<String>, // Mermaid mindmap code
    pub created_at: i64,         // Unix timestamp
}

// Internal wrapper for notes file
struct NotesStore {
    notes: Vec<Note>,
}
```

---

## CRUD Patterns

### Read with Graceful Fallback

```rust
pub fn load_config(&self) -> Result<AppConfig> {
    let path = self.app_dir.join(CONFIG_FILE);
    if !path.exists() {
        return Ok(AppConfig::default());  // Return defaults if file missing
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::StoreError(e.to_string()))?;
    serde_json::from_str(&content)
        .map_err(|e| AppError::StoreError(e.to_string()))
}
```

### Upsert Pattern (Insert or Update)

```rust
pub fn save_note(&self, note: Note) -> Result<()> {
    let mut notes = self.load_notes()?;
    if let Some(pos) = notes.iter().position(|n| n.id == note.id) {
        notes[pos] = note;           // Update existing
    } else {
        notes.insert(0, note);       // Insert at top (newest first)
    }
    self.save_notes(&notes)
}
```

### Write with Pretty Print

```rust
fn save_notes(&self, notes: &[Note]) -> Result<()> {
    let store = NotesStore { notes: notes.to_vec() };
    let content = serde_json::to_string_pretty(&store)
        .map_err(|e| AppError::StoreError(e.to_string()))?;
    std::fs::write(self.app_dir.join(NOTES_FILE), content)
        .map_err(|e| AppError::StoreError(e.to_string()))
}
```

---

## Schema Evolution Strategy

Use `#[serde(default)]` for backward compatibility when adding new fields:

```rust
#[derive(Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]           // ← Existing JSON without this field will use Default
    pub asr_provider: AsrProvider,
    // ...
}
```

This means old JSON files missing new fields will deserialize correctly using default values.

---

## Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| File names | `snake_case` constants | `CONFIG_FILE = "config.json"` |
| Struct fields | `snake_case` | `created_at`, `api_key` |
| ID generation | UUID v4 | `uuid::Uuid::new_v4().to_string()` |
| Timestamps | Unix epoch (i64) | `chrono::Utc::now().timestamp()` |

---

## Common Mistakes

### ❌ Don't: Forget `#[serde(default)]` when adding new fields

Adding a new field without default will break deserialization of existing data.

### ❌ Don't: Hold the Mutex lock across async boundaries

```rust
// BAD: lock held across .await
let store = state.store.lock().unwrap();
let result = store.some_async_operation().await; // Deadlock risk!
```

### ✅ Do: Lock, read/write, unlock immediately

```rust
// GOOD: lock scope is minimal
let config = state.store.lock().unwrap().load_config()?;
// Lock is released here, then do async work
let result = do_async_work(&config).await?;
```

### ❌ Don't: Use concurrent writes without Mutex

The Store is wrapped in `Mutex<Store>` in `AppState` to prevent data races from concurrent Tauri commands.
