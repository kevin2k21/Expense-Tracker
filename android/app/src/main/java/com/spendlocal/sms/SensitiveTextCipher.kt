package com.spendlocal.sms

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts short-lived raw SMS and notification text before SQLite storage. */
internal class SensitiveTextCipher {
  fun encrypt(value: String): String {
    if (value.startsWith(PREFIX)) return value
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val payload = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    return "$PREFIX$iv:$payload"
  }

  fun decrypt(value: String): String {
    if (!value.startsWith(PREFIX)) return value
    val parts = value.split(':', limit = 4)
    require(parts.size == 4 && parts[0] == "enc" && parts[1] == "v1") {
      "Invalid encrypted queue value"
    }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(128, Base64.decode(parts[2], Base64.NO_WRAP)),
    )
    return String(cipher.doFinal(Base64.decode(parts[3], Base64.NO_WRAP)), Charsets.UTF_8)
  }

  private fun getOrCreateKey(): SecretKey = synchronized(KEY_LOCK) {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore",
    ).run {
      init(
        KeyGenParameterSpec.Builder(
          KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build(),
      )
      generateKey()
    }
  }

  private companion object {
    const val PREFIX = "enc:v1:"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val KEY_ALIAS = "spendlocal.capture.queue.v1"
    val KEY_LOCK = Any()
  }
}
