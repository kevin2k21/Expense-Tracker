package com.spendlocal.sms

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class DatabaseKeyStore(private val context: Context) {
  private val alias = "spendlocal.database.master"
  private val preferences = context.getSharedPreferences("secure_database_key", Context.MODE_PRIVATE)

  fun getOrCreateHexKey(): String {
    val encrypted = preferences.getString("encrypted", null)
    val iv = preferences.getString("iv", null)
    val raw = if (encrypted != null && iv != null) {
      decrypt(Base64.decode(encrypted, Base64.NO_WRAP), Base64.decode(iv, Base64.NO_WRAP))
    } else {
      ByteArray(32).also(SecureRandom()::nextBytes).also(::persist)
    }
    return raw.joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  private fun persist(raw: ByteArray) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
    preferences.edit()
      .putString("encrypted", Base64.encodeToString(cipher.doFinal(raw), Base64.NO_WRAP))
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .apply()
  }

  private fun decrypt(encrypted: ByteArray, iv: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateMasterKey(), GCMParameterSpec(128, iv))
    return cipher.doFinal(encrypted)
  }

  private fun getOrCreateMasterKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(
        KeyGenParameterSpec.Builder(
          alias,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build(),
      )
      generateKey()
    }
  }
}
