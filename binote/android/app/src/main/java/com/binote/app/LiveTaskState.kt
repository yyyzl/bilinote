package com.binote.app

import org.json.JSONObject
import java.io.File

/** Versioned private-file contract; never contains transcript, API errors or credentials. */
data class LiveTaskState(
    val sessionId: String,
    val taskId: String,
    val noteId: String?,
    val stage: String,
    val activeCount: Int,
    val queuedCount: Int,
    val updatedAt: Long
) {
    companion object {
        const val FILENAME = ".live_task_state.json"
        private const val MAX_BYTES = 8192L
        private val identifier = Regex("[A-Za-z0-9_-]{1,64}")
        val labels = mapOf(
            "queued" to "排队中",
            "fetching" to "获取信息",
            "subtitles" to "读取字幕",
            "downloading" to "下载音频",
            "transcribing" to "转录中",
            "summary" to "生成总结",
            "mindmap" to "生成导图",
            "summary_mindmap" to "生成笔记",
            "retrying" to "重试中",
            "saving" to "保存笔记",
            "processing" to "处理中"
        )

        fun validId(value: String?) = value != null && identifier.matches(value)

        fun read(file: File, now: Long): LiveTaskState? = try {
            if (!file.isFile || file.length() > MAX_BYTES) null else parse(file.readText(), now)
        } catch (_: Exception) { null }

        fun parse(text: String, now: Long): LiveTaskState? {
            if (text.length > MAX_BYTES) return null
            return try {
                val json = JSONObject(text)
                fun integer(key: String): Long {
                    val value = json.get(key)
                    require(value is Int || value is Long)
                    return (value as Number).toLong()
                }
                fun string(key: String) = json.get(key) as String
                require(integer("version") == 1L)
                val session = string("session_id")
                val task = string("task_id")
                val note = if (json.isNull("note_id")) null else string("note_id")
                val stage = string("stage")
                val count = integer("active_count")
                val queued = integer("queued_count")
                val updated = integer("updated_at")
                require(validId(session) && validId(task) && (note == null || validId(note)))
                require(stage in labels && count in 1..10000 && queued in 0..count)
                require(updated >= 0 && updated >= now - 10 && updated <= now + 5)
                LiveTaskState(session, task, note, stage, count.toInt(), queued.toInt(), updated)
            } catch (_: Exception) { null }
        }
    }
}
