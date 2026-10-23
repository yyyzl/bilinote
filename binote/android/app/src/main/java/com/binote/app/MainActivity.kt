package com.binote.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import java.io.File
import org.json.JSONObject

class MainActivity : TauriActivity() {

  companion object {
    private const val TAG = "BiNote"
    private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001

    // 重试配置
    private const val MAX_RETRY_COUNT = 20      // 最多重试 20 次
    private const val RETRY_DELAY_MS = 500L     // 每次重试间隔 500ms（总计最多等待 10 秒）

    // 任务标志轮询间隔
    private const val TASK_FLAG_POLL_MS = 1000L

    // 本地偏好：记录是否已经弹过电池优化白名单授权（只打扰用户一次）
    private const val PREFS_NAME = "binote_prefs"
    private const val KEY_BATTERY_OPT_PROMPTED = "battery_opt_prompted"
  }

  // 通知导航目标文件名（与 Rust notification.rs 中的 NAV_TARGET_FILENAME 一致）
  private val NAV_TARGET_FILENAME = ".notification_nav_target"
  // 任务运行标志文件名（与 Rust commands.rs get_task_flag_path 写入的 .task_running 一致）
  private val TASK_FLAG_FILENAME = ".task_running"
  // 通知 Intent 的 key（与 Tauri notification 插件 TauriNotificationManager.kt 一致）
  private val NOTIFICATION_INTENT_KEY = "NotificationId"

  private var webView: WebView? = null
  private var pendingSharedUrl: String? = null
  private var pendingNotificationNoteId: String? = null
  private val handler = Handler(Looper.getMainLooper())
  // 当前是否已请求前台服务运行（避免轮询里重复 start）
  private var foregroundServiceActive = false

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView

    // 处理待发送的 URL
    pendingSharedUrl?.let { url ->
      Log.d(TAG, "WebView created, sending pending URL: $url")
      sendUrlToWebViewWithRetry(url)
      pendingSharedUrl = null
    }

    // 处理待发送的通知点击导航
    pendingNotificationNoteId?.let { noteId ->
      Log.d(TAG, "WebView created, sending pending notification noteId: $noteId")
      sendNotificationClickToWebViewWithRetry(noteId)
      pendingNotificationNoteId = null
    }
  }

  /**
   * 拦截系统返回（含 Android 14 预测式右滑手势），在非根路由时走 React Router history.back()，
   * 仅当已经位于根路由（HashRouter 的 #/ 或空 hash）时才退出 Activity。
   */
  private val backPressedCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      val wv = webView
      if (wv == null) {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
        return
      }
      val js = "(function(){try{var h=window.location.hash||'';if(h && h!=='#/' && h!=='#'){window.history.back();return 'navigated';}}catch(e){}return 'root';})();"
      wv.post {
        wv.evaluateJavascript(js) { result ->
          // evaluateJavascript 返回 JSON 字符串，'root' 表示已是根路由
          if (result == null || result == "null" || result.contains("root")) {
            finish()
          }
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, backPressedCallback)
    requestNotificationPermission()
    handleShareIntent(intent)
    handleNotificationClickIntent(intent)
    startTaskFlagPolling()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleShareIntent(intent)
    handleNotificationClickIntent(intent)
  }

  private fun handleShareIntent(intent: Intent?) {
    if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
      intent.getStringExtra(Intent.EXTRA_TEXT)?.let { sharedText ->
        val url = extractUrl(sharedText)
        if (url != null) {
          Log.d(TAG, "Share intent received, URL: $url")
          if (webView != null) {
            sendUrlToWebViewWithRetry(url)
          } else {
            Log.d(TAG, "WebView not ready, buffering URL")
            pendingSharedUrl = url
          }
        }
      }
    }
  }

  /**
   * 处理通知点击 Intent
   * 检测是否为通知点击产生的 Intent，读取导航目标文件获取 note_id
   */
  private fun handleNotificationClickIntent(intent: Intent?) {
    // Ongoing notifications carry their own target; never consume a completion's shared file.
    if (intent?.action == LiveTaskNotification.ACTION_OPEN) {
      val target = LiveTaskNotification.navigationTarget(intent)
      intent.action = null
      intent.removeExtra(LiveTaskNotification.EXTRA_NOTE_ID)
      if (webView != null) {
        sendNotificationClickToWebViewWithRetry(target)
      } else {
        pendingNotificationNoteId = target
      }
      return
    }
    // 检查 Intent 是否来自通知点击（Tauri notification 插件设置 ACTION_MAIN + NotificationId extra）
    if (intent?.action != Intent.ACTION_MAIN) return
    val notificationId = intent.getIntExtra(NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
    if (notificationId == Int.MIN_VALUE) return

    Log.d(TAG, "Notification click detected, notificationId: $notificationId")

    // 读取 Rust 端写入的导航目标文件
    val noteId = readAndDeleteNavTarget()
    if (noteId == null) {
      Log.d(TAG, "No notification nav target file found")
      return
    }

    Log.d(TAG, "Notification nav target noteId: $noteId")
    if (webView != null) {
      sendNotificationClickToWebViewWithRetry(noteId)
    } else {
      Log.d(TAG, "WebView not ready, buffering notification noteId")
      pendingNotificationNoteId = noteId
    }
  }

  /**
   * 读取并删除通知导航目标文件
   * 文件路径与 Rust notification.rs 中的 write_nav_target() 一致
   */
  private fun readAndDeleteNavTarget(): String? {
    return try {
      val dataDir = filesDir.parentFile
      val navFile = File(dataDir, NAV_TARGET_FILENAME)
      if (!navFile.exists()) return null
      val noteId = navFile.readText().trim()
      navFile.delete()
      noteId.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to read notification nav target", e)
      null
    }
  }

  /**
   * 带重试机制发送通知点击事件到 WebView
   * 模式与 sendUrlToWebViewWithRetry 完全一致
   */
  private fun sendNotificationClickToWebViewWithRetry(noteId: String, retryCount: Int = 0) {
    val checkReadyJs = "typeof window.__BINOTE_NOTIFICATION_CLICK__ === 'function'"
    val sendJs = "window.__BINOTE_NOTIFICATION_CLICK__(${JSONObject.quote(noteId)})"

    webView?.post {
      webView?.evaluateJavascript(checkReadyJs) { result ->
        when {
          result == "true" -> {
            Log.d(TAG, "Notification handler ready, sending noteId (attempt ${retryCount + 1})")
            webView?.evaluateJavascript(sendJs) { sendResult ->
              Log.d(TAG, "Notification click send result: $sendResult")
            }
          }
          retryCount < MAX_RETRY_COUNT -> {
            Log.d(TAG, "Notification handler not ready, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/$MAX_RETRY_COUNT)")
            handler.postDelayed({
              sendNotificationClickToWebViewWithRetry(noteId, retryCount + 1)
            }, RETRY_DELAY_MS)
          }
          else -> {
            Log.w(TAG, "Notification handler not ready after $MAX_RETRY_COUNT attempts, giving up")
          }
        }
      }
    }
  }

  private fun extractUrl(text: String): String? {
    val patterns = listOf(
      "https?://www\\.bilibili\\.com/video/[A-Za-z0-9]+",
      "https?://b23\\.tv/[A-Za-z0-9]+",
      "https?://m\\.bilibili\\.com/video/[A-Za-z0-9]+",
      "BV[A-Za-z0-9]{10}"
    )
    for (pattern in patterns) {
      Regex(pattern).find(text)?.let { return it.value }
    }
    return text.trim().takeIf { it.isNotEmpty() }
  }

  /**
   * 带重试机制的 URL 发送
   * 会先检查 JS 函数是否存在，如果不存在则等待重试
   */
  private fun sendUrlToWebViewWithRetry(url: String, retryCount: Int = 0) {
    val escapedUrl = url.replace("\\", "\\\\").replace("\"", "\\\"")

    // 检查函数是否存在的 JS
    val checkReadyJs = "typeof window.__BINOTE_RECEIVE_SHARE__ === 'function'"

    // 发送 URL 的 JS
    val sendJs = "window.__BINOTE_RECEIVE_SHARE__(\"$escapedUrl\")"

    webView?.post {
      webView?.evaluateJavascript(checkReadyJs) { result ->
        when {
          result == "true" -> {
            // 函数存在，发送 URL
            Log.d(TAG, "Share handler ready, sending URL (attempt ${retryCount + 1})")
            webView?.evaluateJavascript(sendJs) { sendResult ->
              Log.d(TAG, "Send result: $sendResult")
            }
          }
          retryCount < MAX_RETRY_COUNT -> {
            // 函数不存在，继续重试
            Log.d(TAG, "Share handler not ready, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/$MAX_RETRY_COUNT)")
            handler.postDelayed({
              sendUrlToWebViewWithRetry(url, retryCount + 1)
            }, RETRY_DELAY_MS)
          }
          else -> {
            // 超过最大重试次数
            Log.w(TAG, "Share handler not ready after $MAX_RETRY_COUNT attempts, giving up")
          }
        }
      }
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(taskFlagPoller)
    super.onDestroy()
  }

  /**
   * 轮询 .task_running 标志文件，据此启停前台服务。
   *
   * 为什么用轮询而非 FileObserver：ColorOS 等 ROM 上 FileObserver 依赖的 inotify 事件
   * 对应用私有目录不可靠（实测：标志文件已写入、通知跳转用的同目录文件能被主动读到，
   * 但 FileObserver 的创建事件不送达，前台服务从未启动）。这里改用与通知跳转相同的
   * “主动读文件”机制，可靠性有保证。
   *
   * 也不依赖 onPause/onResume：小窗 / 分屏 / 侧边栏属于多窗口模式，那对回调语义不等于
   * “前台/后台”，会误停前台服务，使长时间的流式 LLM 请求在后台被系统掐断而失败。
   * 标志由 Rust TaskFlagGuard 在任务运行期间写入、结束时删除，与 Activity 生命周期解耦。
   */
  private val taskFlagPoller = object : Runnable {
    override fun run() {
      try {
        val flagExists = File(this@MainActivity.filesDir.parentFile, TASK_FLAG_FILENAME).exists()
        if (flagExists && !foregroundServiceActive) {
          Log.d(TAG, "task flag present -> start foreground service")
          TranscribeService.start(this@MainActivity, "正在后台处理...")
          foregroundServiceActive = true
          maybeRequestBatteryOptimizationExemption()
        } else if (!flagExists && foregroundServiceActive) {
          Log.d(TAG, "task flag gone -> stop foreground service")
          TranscribeService.stop(this@MainActivity)
          foregroundServiceActive = false
        }
      } catch (e: Exception) {
        Log.w(TAG, "task flag poll failed", e)
      }
      handler.postDelayed(this, TASK_FLAG_POLL_MS)
    }
  }

  private fun startTaskFlagPolling() {
    Log.d(TAG, "Polling task flag: ${filesDir.parentFile?.absolutePath}/$TASK_FLAG_FILENAME")
    handler.removeCallbacks(taskFlagPoller)
    handler.post(taskFlagPoller)
  }

  /**
   * 首个后台任务启动时，引导用户把应用加入电池优化白名单（系统级授权弹窗，只提示一次）。
   *
   * ColorOS 等激进 ROM 会在应用进入小窗 / 收起后台后冻结进程（应用速冻），
   * dataSync 前台服务 + WakeLock 都挡不住冻结，白名单是官方渠道里效果最强的豁免手段。
   * 时机选在任务刚启动：用户此刻最能理解"为什么需要后台运行"。
   * 拒绝后不再打扰，可到系统设置 > 电池 中手动开启。
   */
  private fun maybeRequestBatteryOptimizationExemption() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    try {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(packageName)) return

      val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
      if (prefs.getBoolean(KEY_BATTERY_OPT_PROMPTED, false)) return

      // Android 10+ 禁止后台 Activity 启动；仅在本 Activity 可见时弹授权，
      // 本轮跳过的话下次任务启动时会再尝试（未写入 prompted 标记）
      if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return

      startActivity(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
          .setData(Uri.parse("package:$packageName"))
      )
      prefs.edit().putBoolean(KEY_BATTERY_OPT_PROMPTED, true).apply()
      Log.d(TAG, "requested battery optimization exemption")
    } catch (e: Exception) {
      Log.w(TAG, "battery optimization exemption request failed", e)
    }
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          NOTIFICATION_PERMISSION_REQUEST_CODE
        )
      }
    }
  }
}
