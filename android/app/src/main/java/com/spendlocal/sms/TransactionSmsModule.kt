package com.spendlocal.sms

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.provider.Telephony
import java.util.Calendar
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class TransactionSmsModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "TransactionSms"

  @ReactMethod
  fun getCaptureQueueCounts(promise: Promise) {
    try {
      promise.resolve(Arguments.createMap().apply {
        putInt("sms", PendingSmsStore(context).count())
        putInt("notifications", GpayNotificationStore(context).count())
      })
    } catch (error: Exception) {
      promise.reject("QUEUE_COUNT_FAILED", "Unable to read pending alert counts", error)
    }
  }

  @ReactMethod
  fun getAppVersion(promise: Promise) {
    try {
      promise.resolve(context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty())
    } catch (error: Exception) {
      promise.reject("VERSION_UNAVAILABLE", "Unable to read app version", error)
    }
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    val read = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
      PackageManager.PERMISSION_GRANTED
    val receive = ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) ==
      PackageManager.PERMISSION_GRANTED
    promise.resolve(if (read && receive) "granted" else "denied")
  }

  @ReactMethod
  fun getNotificationAccessStatus(promise: Promise) {
    val enabled = Settings.Secure.getString(
      context.contentResolver, "enabled_notification_listeners",
    ).orEmpty()
    val component = ComponentName(context, GpayNotificationListener::class.java)
    promise.resolve(
      if (enabled.split(':').any { ComponentName.unflattenFromString(it) == component })
        "granted" else "denied",
    )
  }

  @ReactMethod
  fun openNotificationAccessSettings(promise: Promise) {
    try {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      })
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SETTINGS_UNAVAILABLE", "Unable to open notification access settings", error)
    }
  }

  @ReactMethod
  fun getPendingGpayNotifications(limit: Double, promise: Promise) {
    try {
      val store = GpayNotificationStore(context)
      store.discardOlderThan(System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000)
      val rows = Arguments.createArray()
      store.list(limit.toInt()).forEach { item ->
        rows.pushMap(Arguments.createMap().apply {
          putString("id", item.id)
          putString("packageName", item.packageName)
          putString("title", item.title)
          putString("body", item.body)
          putDouble("postedAt", item.postedAt.toDouble())
        })
      }
      promise.resolve(rows)
    } catch (error: Exception) {
      promise.reject("QUEUE_READ_FAILED", "Unable to read GPay notifications", error)
    }
  }

  @ReactMethod
  fun getNotificationPackages(promise: Promise) {
    val packages = context.getSharedPreferences("transaction_sources", 0)
      .getStringSet("packages", setOf("com.google.android.apps.nbu.paisa.user")).orEmpty()
    val values = Arguments.createArray()
    packages.sorted().forEach(values::pushString)
    promise.resolve(values)
  }

  @ReactMethod
  fun getNotificationAppChoices(promise: Promise) {
    try {
      val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val apps = context.packageManager.queryIntentActivities(launch, 0)
        .distinctBy { it.activityInfo.packageName }
        .sortedBy { it.loadLabel(context.packageManager).toString().lowercase() }
      val result = Arguments.createArray()
      apps.forEach { app ->
        result.pushMap(Arguments.createMap().apply {
          putString("packageName", app.activityInfo.packageName)
          putString("label", app.loadLabel(context.packageManager).toString())
        })
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("APP_LIST_FAILED", "Unable to list installed apps", error)
    }
  }

  @ReactMethod
  fun setNotificationPackages(packages: ReadableArray, promise: Promise) {
    val values = (0 until packages.size()).mapNotNull(packages::getString)
      .filter { it.matches(Regex("[a-zA-Z0-9_.]{3,150}")) }.toSet()
    context.getSharedPreferences("transaction_sources", 0).edit()
      .putStringSet("packages", values).apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun getReviewReminder(promise: Promise) {
    val prefs = ReviewReminder.settings(context)
    promise.resolve(Arguments.createMap().apply {
      putBoolean("enabled", prefs.getBoolean("enabled", false))
      putInt("hour", prefs.getInt("hour", 22))
      putInt("minute", prefs.getInt("minute", 0))
    })
  }

  @ReactMethod
  fun configureReviewReminder(enabled: Boolean, hour: Double, minute: Double, promise: Promise) {
    val h = hour.toInt()
    val m = minute.toInt()
    if (h !in 0..23 || m !in 0..59) {
      promise.reject("INVALID_TIME", "Choose a valid time")
      return
    }
    ReviewReminder.settings(context).edit().putBoolean("enabled", enabled)
      .putInt("hour", h).putInt("minute", m).apply()
    ReviewReminder.schedule(context)
    promise.resolve(null)
  }

  @ReactMethod
  fun snoozeReviewReminder(minutes: Double, promise: Promise) {
    val duration = minutes.toLong().coerceIn(5, 240)
    val preferences = ReviewReminder.settings(context)
    val intended = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, preferences.getInt("hour", 22))
      set(Calendar.MINUTE, preferences.getInt("minute", 0))
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    ReviewReminder.settings(context).edit().putLong("snooze_until",
      maxOf(System.currentTimeMillis(), intended) + duration * 60_000L).apply()
    ReviewReminder.schedule(context)
    promise.resolve(null)
  }

  @ReactMethod
  fun acknowledgeGpayNotifications(ids: ReadableArray, promise: Promise) {
    try {
      GpayNotificationStore(context).acknowledge(
        (0 until ids.size()).mapNotNull(ids::getString),
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QUEUE_WRITE_FAILED", "Unable to acknowledge GPay notifications", error)
    }
  }

  @ReactMethod
  fun getDatabaseKey(promise: Promise) {
    try {
      promise.resolve(DatabaseKeyStore(context).getOrCreateHexKey())
    } catch (error: Exception) {
      promise.reject("KEY_ERROR", "Unable to access the local database key", error)
    }
  }

  @ReactMethod
  fun importInbox(sinceTimestamp: Double, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) !=
      PackageManager.PERMISSION_GRANTED) {
      promise.reject("PERMISSION_DENIED", "SMS inbox permission has not been granted")
      return
    }
    try {
      val store = PendingSmsStore(context)
      var imported = 0
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(sinceTimestamp.toLong().toString()),
        "${Telephony.Sms.DATE} DESC",
      )?.use { cursor ->
        while (cursor.moveToNext() && imported < 5000) {
          val sender = cursor.getString(0).orEmpty()
          val body = cursor.getString(1).orEmpty()
          val receivedAt = cursor.getLong(2)
          if (SmsFilter.looksFinancial(sender, body)) {
            store.enqueue(sender, body, receivedAt)
            imported += 1
          }
        }
      }
      promise.resolve(imported)
    } catch (error: Exception) {
      promise.reject("IMPORT_FAILED", "Unable to import the SMS inbox", error)
    }
  }

  @ReactMethod
  fun getPendingMessages(limit: Double, promise: Promise) {
    try {
      val store = PendingSmsStore(context)
      store.discardCreatedBefore(System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000)
      val rows = Arguments.createArray()
      store.list(limit.toInt()).forEach { sms ->
        rows.pushMap(Arguments.createMap().apply {
          putString("id", sms.id)
          putString("sender", sms.sender)
          putString("body", sms.body)
          putDouble("receivedAt", sms.receivedAt.toDouble())
        })
      }
      promise.resolve(rows)
    } catch (error: Exception) {
      promise.reject("QUEUE_READ_FAILED", "Unable to read pending SMS messages", error)
    }
  }

  @ReactMethod
  fun acknowledgeMessages(ids: ReadableArray, promise: Promise) {
    try {
      val values = (0 until ids.size()).mapNotNull(ids::getString)
      PendingSmsStore(context).acknowledge(values)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QUEUE_WRITE_FAILED", "Unable to acknowledge SMS messages", error)
    }
  }

  @ReactMethod
  fun clearPendingData(promise: Promise) {
    try {
      PendingSmsStore(context).clear()
      GpayNotificationStore(context).clear()
      context.getSharedPreferences("transaction_sources", 0).edit()
        .putStringSet("packages", emptySet()).apply()
      ReviewReminder.settings(context).edit().clear().apply()
      ReviewReminder.schedule(context)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("QUEUE_CLEAR_FAILED", "Unable to clear pending messages", error)
    }
  }
}
