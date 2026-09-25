package com.spendlocal.sms

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.spendlocal.MainActivity
import java.util.Calendar

internal object ReviewReminder {
  private const val PREFS = "review_reminder"
  private const val CHANNEL = "daily_review"
  fun settings(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun schedule(context: Context) {
    val preferences = settings(context)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(context, ReviewReminderReceiver::class.java)
    val pending = PendingIntent.getBroadcast(context, 43020, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    manager.cancel(pending)
    if (!preferences.getBoolean("enabled", false)) return
    val now = System.currentTimeMillis()
    val snooze = preferences.getLong("snooze_until", 0L)
    val calendar = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, preferences.getInt("hour", 22))
      set(Calendar.MINUTE, preferences.getInt("minute", 0))
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= now) add(Calendar.DAY_OF_MONTH, 1)
    }
    val trigger = if (snooze > now) snooze else calendar.timeInMillis
    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending)
  }

  fun show(context: Context) {
    val preferences = settings(context)
    if (!preferences.getBoolean("enabled", false)) return
    if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context,
        Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Daily transaction notes", NotificationManager.IMPORTANCE_DEFAULT))
      val open = PendingIntent.getActivity(context, 43021, Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
      manager.notify(43022, builder.setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("Add notes to today's transactions")
        .setContentText("Capture what each payment was for while it is still fresh.")
        .setContentIntent(open).setAutoCancel(true).build())
    }
    preferences.edit().remove("snooze_until").apply()
    schedule(context)
  }
}

class ReviewReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { ReviewReminder.show(context) }
}

class ReviewBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in setOf(
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_TIMEZONE_CHANGED,
        Intent.ACTION_TIME_CHANGED,
      )) return
    ReviewReminder.schedule(context)
  }
}
