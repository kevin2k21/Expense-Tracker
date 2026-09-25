package com.spendlocal.sms

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService

class GpayNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val enabled = getSharedPreferences("transaction_sources", MODE_PRIVATE)
      .getStringSet("packages", setOf(GPAY_PACKAGE)).orEmpty()
    if (sbn.packageName !in enabled) return
    val extras = sbn.notification.extras
    val title = listOf(
      Notification.EXTRA_TITLE,
      Notification.EXTRA_TITLE_BIG,
    ).firstNotNullOfOrNull { key ->
      extras.getCharSequence(key)?.toString()?.replace(Regex("\\s+"), " ")?.trim()
    } ?: return
    val body = listOf(Notification.EXTRA_BIG_TEXT, Notification.EXTRA_TEXT)
      .firstNotNullOfOrNull { key -> extras.getCharSequence(key)?.toString()?.trim() }.orEmpty()
    if (!TRANSACTION_HINT.containsMatchIn("$title $body")) return

    if (!GpayNotificationStore(applicationContext).enqueue(sbn.key, sbn.packageName, title, body, sbn.postTime)) return
    try {
      startService(Intent(this, SmsHeadlessService::class.java))
      HeadlessJsTaskService.acquireWakeLockNow(this)
    } catch (_: Exception) {
      // The durable notification queue is processed when the app next opens.
    }
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    activeNotifications?.forEach(::onNotificationPosted)
  }

  companion object {
    private const val GPAY_PACKAGE = "com.google.android.apps.nbu.paisa.user"
    private val TRANSACTION_HINT = Regex("\\b(paid you|received|credited|debited|spent|paid to|sent to)\\b", RegexOption.IGNORE_CASE)
  }
}
