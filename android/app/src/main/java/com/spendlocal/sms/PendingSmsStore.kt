package com.spendlocal.sms

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest

internal data class PendingSms(
  val id: String,
  val sender: String,
  val body: String,
  val receivedAt: Long,
)

internal class PendingSmsStore(context: Context) :
  SQLiteOpenHelper(context, "pending_sms.db", null, 2) {

  private val cipher = SensitiveTextCipher()

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE pending_sms (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
      """.trimIndent(),
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 2) encryptExistingRows(db)
  }

  fun enqueue(sender: String, body: String, receivedAt: Long): String {
    val id = fingerprint(sender, body)
    val values = ContentValues().apply {
      put("id", id)
      put("sender", cipher.encrypt(sender.take(80)))
      put("body", cipher.encrypt(body.take(4000)))
      put("received_at", receivedAt)
      put("created_at", System.currentTimeMillis())
    }
    writableDatabase.insertWithOnConflict(
      "pending_sms",
      null,
      values,
      SQLiteDatabase.CONFLICT_IGNORE,
    )
    return id
  }

  fun list(limit: Int): List<PendingSms> {
    val result = mutableListOf<PendingSms>()
    readableDatabase.query(
      "pending_sms",
      arrayOf("id", "sender", "body", "received_at"),
      null,
      null,
      null,
      null,
      // A large history import must not delay today's bank alerts.
      "received_at DESC",
      limit.coerceIn(1, 500).toString(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        result += PendingSms(
          id = cursor.getString(0),
          sender = cipher.decrypt(cursor.getString(1)),
          body = cipher.decrypt(cursor.getString(2)),
          receivedAt = cursor.getLong(3),
        )
      }
    }
    return result
  }

  fun acknowledge(ids: List<String>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      ids.forEach { db.delete("pending_sms", "id = ?", arrayOf(it)) }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun clear() {
    writableDatabase.delete("pending_sms", null, null)
  }

  fun discardCreatedBefore(cutoff: Long) {
    writableDatabase.delete("pending_sms", "created_at < ?", arrayOf(cutoff.toString()))
  }

  fun count(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM pending_sms", null).use { cursor ->
    if (cursor.moveToFirst()) cursor.getInt(0) else 0
  }

  private fun fingerprint(sender: String, body: String): String {
    // The broadcast PDU time and SMS inbox DATE can differ by seconds for the
    // same message. Its content is the stable identity across both paths.
    val input = "${sender.trim()}|${body.trim()}".toByteArray()
    return MessageDigest.getInstance("SHA-256")
      .digest(input)
      .joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  private fun encryptExistingRows(db: SQLiteDatabase) {
    val rows = mutableListOf<Triple<String, String, String>>()
    db.query("pending_sms", arrayOf("id", "sender", "body"), null, null, null, null, null)
      .use { cursor ->
        while (cursor.moveToNext()) rows += Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2))
      }
    rows.forEach { (id, sender, body) ->
      db.update("pending_sms", ContentValues().apply {
        put("sender", cipher.encrypt(sender))
        put("body", cipher.encrypt(body))
      }, "id = ?", arrayOf(id))
    }
  }
}
