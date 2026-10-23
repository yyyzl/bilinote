package com.binote.app

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle

object LiveTaskNotification {
    // Retain the existing channel, including the user's notification preferences.
    const val CHANNEL_ID = "binote_transcribe_channel"
    const val ACTION_OPEN = "com.binote.app.action.OPEN_LIVE_TASK"
    const val ACTION_DISMISS = "com.binote.app.action.DISMISS_LIVE_TASK"
    const val EXTRA_NOTE_ID = "live_note_id"
    const val EXTRA_SESSION_ID = "live_session_id"
    const val PREFS = "binote_live_notifications"
    const val DISMISSED_SESSION = "dismissed_session"
    const val TASK_LIST_TARGET = "@tasks"
    // Public Android/AndroidX contract; the installed API 36 SDK lacks the Builder setter.
    private const val REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

    fun isDismissed(context: Context, session: String?): Boolean =
        session != null && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(DISMISSED_SESSION, null) == session

    fun openIntent(context: Context, state: LiveTaskState?): Intent =
        Intent(context, MainActivity::class.java).apply {
            action = ACTION_OPEN
            data = Uri.parse("binote://live-task/${state?.taskId ?: "tasks"}")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTE_ID, state?.noteId)
        }

    fun navigationTarget(intent: Intent): String =
        intent.getStringExtra(EXTRA_NOTE_ID)?.takeIf { LiveTaskState.validId(it) } ?: TASK_LIST_TARGET

    fun build(context: Context, state: LiveTaskState?, canPromote: Boolean): Notification {
        val label = LiveTaskState.labels[state?.stage] ?: "正在后台处理"
        val text = if (state != null && state.activeCount > 1) {
            "$label · 共 ${state.activeCount} 个任务，${state.queuedCount} 个排队"
        } else label
        val tap = PendingIntent.getActivity(context, 0, openIntent(context, state),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(context, CHANNEL_ID) else Notification.Builder(context)
        builder.setContentTitle("BiNote")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_binote)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setContentIntent(tap)
        if (state != null) {
            val dismiss = Intent(context, LiveNotificationDismissReceiver::class.java).apply {
                action = ACTION_DISMISS
                data = Uri.parse("binote://live-dismiss/${state.sessionId}")
                putExtra(EXTRA_SESSION_ID, state.sessionId)
            }
            builder.setDeleteIntent(PendingIntent.getBroadcast(context, 0, dismiss,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        if (Build.VERSION.SDK_INT >= 36 && state != null &&
            state.queuedCount < state.activeCount && canPromote &&
            !isDismissed(context, state.sessionId)) {
            builder.addExtras(Bundle().apply { putBoolean(REQUEST_PROMOTED_ONGOING, true) })
            builder.setShortCriticalText(label)
            val standard = builder.build()
            if (standard.hasPromotableCharacteristics()) return standard
            // Early Android 16 requires colorization; newer revisions prohibit it.
            // Probe the public eligibility API, not OEM versions or hidden flags.
            val legacy = builder.setColorized(true).build()
            if (legacy.hasPromotableCharacteristics()) return legacy
            builder.setColorized(false)
        }
        return builder.build()
    }
}
