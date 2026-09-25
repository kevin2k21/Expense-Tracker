package com.spendlocal.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

class TransactionSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val grouped = Telephony.Sms.Intents.getMessagesFromIntent(intent)
      .groupBy { "${it.originatingAddress.orEmpty()}|${it.timestampMillis}" }

    var queued = false
    val store = PendingSmsStore(context.applicationContext)
    grouped.values.forEach { parts ->
      val sender = parts.firstOrNull()?.originatingAddress.orEmpty()
      val receivedAt = parts.minOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
      val body = parts.joinToString("") { it.messageBody.orEmpty() }
      if (SmsFilter.looksFinancial(sender, body)) {
        store.enqueue(sender, body, receivedAt)
        queued = true
      }
    }

    if (queued) {
      try {
        context.startService(Intent(context, SmsHeadlessService::class.java))
        HeadlessJsTaskService.acquireWakeLockNow(context)
      } catch (_: Exception) {
        // The durable queue is the fallback; it will be drained on the next app launch.
      }
    }
  }
}
