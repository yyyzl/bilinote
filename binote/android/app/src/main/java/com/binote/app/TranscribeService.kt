package com.binote.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import java.io.File

/**
 * 前台服务：在转录/总结期间保持应用存活
 * 显示一个持久通知，告诉系统这是用户关心的正在进行的任务
 */
class TranscribeService : Service() {

    companion object {
        private const val CHANNEL_ID = LiveTaskNotification.CHANNEL_ID
        private const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.binote.app.action.START_TRANSCRIBE"
        const val ACTION_STOP = "com.binote.app.action.STOP_TRANSCRIBE"
        const val EXTRA_PROGRESS = "progress"
        // 任务运行标志文件名（与 Rust commands.rs / MainActivity 一致）
        private const val TASK_FLAG_FILENAME = ".task_running"
        // 服务自查标志的间隔
        private const val SELF_CHECK_MS = 2000L
        // WakeLock 带超时续期：自查循环每轮刷新；任何异常路径下最迟这么久后自动释放，
        // 避免任务结束后锁泄漏耗电
        private const val WAKE_LOCK_TIMEOUT_MS = 10 * 60 * 1000L

        fun start(context: Context, progress: String = "正在处理...") {
            val intent = Intent(context, TranscribeService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_PROGRESS, progress)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, TranscribeService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        fun updateProgress(context: Context, progress: String) {
            val intent = Intent(context, TranscribeService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_PROGRESS, progress)
            }
            context.startService(intent)
        }
    }

    private var foregroundStarted = false
    private var lastNotificationKey: String? = null
    private var lastSessionId: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    // 自查兜底：服务运行期间定时检查任务标志，标志消失即自停。
    // 覆盖“Activity 被销毁、其轮询停止后任务才结束”的场景，避免前台服务/通知残留。
    // 同时借这个循环给 WakeLock 续期（每轮重置超时），锁的生命周期与任务标志严格对齐。
    private val flagSelfCheck = object : Runnable {
        override fun run() {
            val flagExists = File(this@TranscribeService.filesDir.parentFile, TASK_FLAG_FILENAME).exists()
            if (!flagExists) {
                releaseKeepAliveLocks()
                this@TranscribeService.stopForeground(STOP_FOREGROUND_REMOVE)
                this@TranscribeService.stopSelf()
            } else {
                startForegroundWithNotification()
                acquireKeepAliveLocks()
                handler.postDelayed(this, SELF_CHECK_MS)
            }
        }
    }

    /**
     * 任务期间持有部分唤醒锁 + WiFi 锁：
     * 息屏 / 小窗 / 收起后台时防止 CPU 进入休眠、WiFi 降速，
     * 减少流式 ASR / LLM 长连接被掐断的概率（配合电池优化白名单效果最佳）。
     * setReferenceCounted(false)：重复 acquire 只刷新超时，不叠加计数，release 一次即彻底释放。
     */
    private fun acquireKeepAliveLocks() {
        val wl = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BiNote:TranscribeService")
            .apply { setReferenceCounted(false) }
            .also { wakeLock = it }
        wl.acquire(WAKE_LOCK_TIMEOUT_MS)

        if (wifiLock == null) {
            @Suppress("DEPRECATION")
            wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "BiNote:TranscribeService")
                .apply { setReferenceCounted(false) }
        }
        if (wifiLock?.isHeld != true) {
            wifiLock?.acquire()
        }
    }

    private fun releaseKeepAliveLocks() {
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        if (wifiLock?.isHeld == true) {
            wifiLock?.release()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        handler.removeCallbacks(flagSelfCheck)
        if (intent?.action == ACTION_STOP || !File(filesDir.parentFile, TASK_FLAG_FILENAME).exists()) {
            releaseKeepAliveLocks()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } else {
            startForegroundWithNotification()
            acquireKeepAliveLocks()
            handler.postDelayed(flagSelfCheck, SELF_CHECK_MS)
        }
        // START_NOT_STICKY：进程被系统杀死后不自动重建本服务。
        // 后端转录/LLM 任务（tokio）随进程消亡而终止，重建一个无任务的前台服务只会留下幽灵通知；
        // 保活只需在任务运行期间维持 startForeground 即可，由 .task_running 标志驱动启停。
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacks(flagSelfCheck)
        releaseKeepAliveLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "视频转录",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "显示视频转录进度"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundWithNotification() {
        val state = LiveTaskState.read(
            File(filesDir.parentFile, LiveTaskState.FILENAME),
            System.currentTimeMillis() / 1000
        )
        if (state != null) lastSessionId = state.sessionId
        val dismissed = LiveTaskNotification.isDismissed(this, lastSessionId)
        // Do not recreate a notification that the user removed during this batch.
        if (foregroundStarted && dismissed) return
        val manager = getSystemService(NotificationManager::class.java)
        val canPromote = try {
            Build.VERSION.SDK_INT >= 36 && manager.canPostPromotedNotifications() && !dismissed
        } catch (_: SecurityException) { false }
        // Heartbeats update the file but not the visible notification. At most one update / poll.
        val key = "${state?.copy(updatedAt = 0L)}:$canPromote"
        if (foregroundStarted && key == lastNotificationKey) return
        val notification = createNotification(state, canPromote)
        try {
            if (!foregroundStarted) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                foregroundStarted = true
            } else {
                manager.notify(NOTIFICATION_ID, notification)
            }
            lastNotificationKey = key
        } catch (error: SecurityException) {
            // Notification permissions must not propagate into the Rust task pipeline.
            Log.w("BiNote", "Task notification was rejected", error)
        }
    }

    private fun createNotification(state: LiveTaskState?, canPromote: Boolean): Notification =
        LiveTaskNotification.build(this, state, canPromote)
}
