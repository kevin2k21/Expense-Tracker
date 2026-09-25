package com.spendlocal.sms

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest

internal data class PendingGpayNotification(
  val id: String,
  val packageName: String,
  val title: String,
  val body: String,
  val postedAt: Long,
)

internal class GpayNotificationStore(context: Context) :
  SQLiteOpenHelper(context, "pending_gpay.db", null, 4) {

  private val cipher = SensitiveTextCipher()

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """CREATE TABLE pending_gpay (
        id TEXT PRIMARY KEY,
        package_name TEXT NOT NULL DEFAULT 'com.google.android.apps.nbu.paisa.user',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        posted_at INTEGER NOT NULL
      )""".trimIndent(),
    )
    db.execSQL("CREATE TABLE seen_notifications (id TEXT PRIMARY KEY, acknowledged_at INTEGER NOT NULL)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) {
      db.execSQL("ALTER TABLE pending_gpay ADD COLUMN package_name TEXT NOT NULL DEFAULT 'com.google.android.apps.nbu.paisa.user'")
      db.execSQL("ALTER TABLE pending_gpay ADD COLUMN body TEXT NOT NULL DEFAULT ''")
    }
    if (oldVersion < 3) db.execSQL("CREATE TABLE seen_notifications (id TEXT PRIMARY KEY, acknowledged_at INTEGER NOT NULL)")
    if (oldVersion < 4) encryptExistingRows(db)
  }

  fun enqueue(notificationKey: String, packageName: String, title: String, body: String, postedAt: Long): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest("$notificationKey|$packageName|$postedAt".toByteArray())
      .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    readableDatabase.query("seen_notifications", arrayOf("id"), "id = ?",
      arrayOf(digest), null, null, null, "1").use { if (it.moveToFirst()) return false }
    val values = ContentValues().apply {
      put("id", digest)
      put("package_name", packageName)
      put("title", cipher.encrypt(title.take(160)))
      put("body", cipher.encrypt(body.take(240)))
      put("posted_at", postedAt)
    }
    return writableDatabase.insertWithOnConflict(
      "pending_gpay", null, values, SQLiteDatabase.CONFLICT_IGNORE,
    ) != -1L
  }

  fun list(limit: Int): List<PendingGpayNotification> {
    val result = mutableListOf<PendingGpayNotification>()
    readableDatabase.query(
      "pending_gpay", arrayOf("id", "package_name", "title", "body", "posted_at"),
      null, null, null, null, "posted_at ASC", limit.coerceIn(1, 500).toString(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        result += PendingGpayNotification(
          cursor.getString(0),
          cursor.getString(1),
          cipher.decrypt(cursor.getString(2)),
          cipher.decrypt(cursor.getString(3)),
          cursor.getLong(4),
        )
      }
    }
    return result
  }

  fun acknowledge(ids: List<String>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      ids.forEach {
        db.insertWithOnConflict("seen_notifications", null, ContentValues().apply {
          put("id", it)
          put("acknowledged_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_IGNORE)
        db.delete("pending_gpay", "id = ?", arrayOf(it))
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun clear() {
    writableDatabase.delete("pending_gpay", null, null)
    writableDatabase.delete("seen_notifications", null, null)
  }

  fun count(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM pending_gpay", null).use { cursor ->
    if (cursor.moveToFirst()) cursor.getInt(0) else 0
  }

  fun discardOlderThan(cutoff: Long) {
    writableDatabase.delete("pending_gpay", "posted_at < ?", arrayOf(cutoff.toString()))
    writableDatabase.delete("seen_notifications", "acknowledged_at < ?", arrayOf(cutoff.toString()))
  }

  private fun encryptExistingRows(db: SQLiteDatabase) {
    val rows = mutableListOf<Triple<String, String, String>>()
    db.query("pending_gpay", arrayOf("id", "title", "body"), null, null, null, null, null)
      .use { cursor ->
        while (cursor.moveToNext()) rows += Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2))
      }
    rows.forEach { (id, title, body) ->
      db.update("pending_gpay", ContentValues().apply {
        put("title", cipher.encrypt(title))
        put("body", cipher.encrypt(body))
      }, "id = ?", arrayOf(id))
    }
  }
}
