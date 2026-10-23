package com.binote.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Explicit, non-exported receiver; dismissal affects display, never cancels the task. */
class LiveNotificationDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != LiveTaskNotification.ACTION_DISMISS) return
        val session = intent.getStringExtra(LiveTaskNotification.EXTRA_SESSION_ID)
        if (!LiveTaskState.validId(session)) return
        context.getSharedPreferences(LiveTaskNotification.PREFS, Context.MODE_PRIVATE).edit()
            .putString(LiveTaskNotification.DISMISSED_SESSION, session).apply()
    }
}
