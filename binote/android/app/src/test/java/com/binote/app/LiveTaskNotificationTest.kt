package com.binote.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LiveTaskNotificationTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private fun state() = LiveTaskState("batch-1", "task-1", "note-1", "transcribing", 2, 1, 100L)
    private fun json() = JSONObject("""{
        "version":1,"session_id":"batch-1","task_id":"task-1","note_id":"note-1",
        "stage":"transcribing","active_count":2,"queued_count":1,"updated_at":100
    }""")

    @Test fun parsesFreshContractButRejectsMalformedStaleAndUnknownState() {
        assertEquals(state(), LiveTaskState.parse(json().toString(), 105L))
        assertNull(LiveTaskState.parse("broken", 100L))
        assertNull(LiveTaskState.parse(json().toString(), 111L))
        assertNull(LiveTaskState.parse(json().toString(), 94L))
        for ((field, value) in listOf(
            "version" to 2, "active_count" to 0, "queued_count" to 3,
            "stage" to "API_KEY", "task_id" to "../unsafe", "note_id" to "../unsafe",
            "version" to "1", "active_count" to 1.5
        )) {
            assertNull(field, LiveTaskState.parse(json().put(field, value).toString(), 100L))
        }
        assertNull(LiveTaskState.parse(jsonWithoutSession(), 100L))
        assertNull(LiveTaskState.parse(json().put("updated_at", -1).toString(), 100L))
        assertNull(LiveTaskState.parse(" ".repeat(9000), 100L))
        val noNote = json().put("note_id", JSONObject.NULL)
        assertNull(LiveTaskState.parse(noNote.toString(), 100L)!!.noteId)
    }

    private fun jsonWithoutSession(): String {
        val value = json()
        value.remove("session_id")
        return value.toString()
    }

    @Test fun api35FallsBackToStandardPrivateOngoingNotification() {
        val notification = LiveTaskNotification.build(context, state(), true)
        assertFalse(notification.extras.getBoolean("android.requestPromotedOngoing"))
        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertTrue(notification.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertNotNull(notification.contentIntent)
        assertNotNull(notification.deleteIntent)
        assertNull(notification.contentView)
    }

    @Test @Config(sdk = [36])
    fun api36RequestsPromotionOnlyForAllowedRunningWork() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(
            LiveTaskNotification.CHANNEL_ID, "任务进度", NotificationManager.IMPORTANCE_LOW))
        val promoted = LiveTaskNotification.build(context, state(), true)
        assertTrue(promoted.extras.getBoolean("android.requestPromotedOngoing"))
        assertTrue(promoted.hasPromotableCharacteristics())
        assertEquals("转录中", promoted.shortCriticalText)
        assertFalse(LiveTaskNotification.build(context, state(), false)
            .extras.getBoolean("android.requestPromotedOngoing"))
        assertFalse(LiveTaskNotification.build(context, state().copy(stage = "queued", queuedCount = 2), true)
            .extras.getBoolean("android.requestPromotedOngoing"))
        assertFalse(LiveTaskNotification.build(context, null, true)
            .extras.getBoolean("android.requestPromotedOngoing"))
    }

    @Test fun nativeIntentCarriesItsOwnNoteAndDifferentTasksHaveDifferentIdentity() {
        val first = LiveTaskNotification.build(context, state(), false)
        val firstIntent = shadowOf(first.contentIntent).savedIntent
        assertEquals("note-1", firstIntent.getStringExtra(LiveTaskNotification.EXTRA_NOTE_ID))
        assertEquals(LiveTaskNotification.ACTION_OPEN, firstIntent.action)
        val next = LiveTaskNotification.build(context,
            state().copy(taskId = "task-2", noteId = "note-2"), false)
        assertNotEquals(first.contentIntent, next.contentIntent)
        assertEquals("note-1", shadowOf(first.contentIntent).savedIntent
            .getStringExtra(LiveTaskNotification.EXTRA_NOTE_ID))
        val noNote = LiveTaskNotification.openIntent(context, state().copy(noteId = null))
        assertEquals("@tasks", LiveTaskNotification.navigationTarget(noNote))
        assertEquals("note-1", LiveTaskNotification.navigationTarget(firstIntent))
        assertEquals("@tasks", LiveTaskNotification.navigationTarget(firstIntent
            .putExtra(LiveTaskNotification.EXTRA_NOTE_ID, "../settings")))
    }

    @Test fun dismissalSuppressesTheWholeBatchButNotANewBatch() {
        val notification = LiveTaskNotification.build(context, state(), false)
        LiveNotificationDismissReceiver().onReceive(context, shadowOf(notification.deleteIntent).savedIntent)
        assertTrue(LiveTaskNotification.isDismissed(context, "batch-1"))
        assertFalse(LiveTaskNotification.isDismissed(context, "batch-2"))
        LiveNotificationDismissReceiver().onReceive(context, Intent())
        assertTrue(LiveTaskNotification.isDismissed(context, "batch-1"))
    }

    @Test fun serviceUpdatesStageFallsBackWhenStaleAndRespectsBatchDismissal() {
        val flag = File(context.filesDir.parentFile, ".task_running")
        val snapshot = File(context.filesDir.parentFile, LiveTaskState.FILENAME)
        val now = System.currentTimeMillis() / 1000
        val data = json().put("updated_at", now)
        flag.writeText("1")
        snapshot.writeText(data.toString())
        val controller = Robolectric.buildService(TranscribeService::class.java).create()
        val service = controller.get()
        val manager = context.getSystemService(NotificationManager::class.java)
        fun current() = shadowOf(manager).getNotification(1001)
        fun poll() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        try {
            service.onStartCommand(Intent(context, TranscribeService::class.java)
                .setAction(TranscribeService.ACTION_START), 0, 1)
            assertTrue(current().extras.getString(Notification.EXTRA_TEXT)!!.contains("转录中"))
            snapshot.writeText(data.put("stage", "summary").toString())
            poll()
            assertTrue(current().extras.getString(Notification.EXTRA_TEXT)!!.contains("生成总结"))

            snapshot.writeText(data.put("updated_at", now - 20).toString())
            poll()
            assertEquals("正在后台处理", current().extras.getString(Notification.EXTRA_TEXT))
            assertFalse(shadowOf(service).isStoppedBySelf)

            snapshot.writeText(data.put("updated_at", System.currentTimeMillis() / 1000).toString())
            poll()
            LiveNotificationDismissReceiver().onReceive(context, shadowOf(current().deleteIntent).savedIntent)
            manager.cancel(1001) // The OS already removed the notification before deleteIntent.
            poll()
            assertNull(current())
            snapshot.writeText(data.put("session_id", "batch-2").put("updated_at", System.currentTimeMillis() / 1000).toString())
            poll()
            assertNotNull(current())
        } finally { flag.delete(); snapshot.delete(); controller.destroy() }
    }

    @Test fun foregroundServiceStopsAfterLastTaskFlagIsRemoved() {
        val flag = File(context.filesDir.parentFile, ".task_running")
        flag.writeText("1")
        val controller = Robolectric.buildService(TranscribeService::class.java).create()
        val service = controller.get()
        try {
            service.onStartCommand(Intent(context, TranscribeService::class.java)
                .setAction(TranscribeService.ACTION_START), 0, 1)
            val manager = context.getSystemService(NotificationManager::class.java)
            assertNotNull(shadowOf(manager).getNotification(1001))
            flag.delete()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
            assertNull(shadowOf(manager).getNotification(1001))
            assertTrue(shadowOf(service).isStoppedBySelf)
        } finally { flag.delete(); controller.destroy() }
    }
}
