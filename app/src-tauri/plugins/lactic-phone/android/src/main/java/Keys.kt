// The rider's API keys on Android (the coach's AI key, intervals.icu, the Strava sign-in): the
// core's secrets.rs keeps them as one small JSON map, which lands here encrypted under a key that
// never leaves the Android Keystore, like the pairing (Pairing.kt). Only the core's Rust reaches
// these commands (they have no permission), so the web layer can't read a key back.

package fit.lactic.phone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object KeysStore {
    private const val PREFS = "lactic.phone"
    private const val ITEM = "keys"
    private const val KEY_ALIAS = "lactic-keys"

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun secretKey(): SecretKey {
        (keyStore().getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    /** The saved map's JSON, or null when nothing is saved. Throws when the Keystore can't answer now. */
    @Synchronized
    fun read(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stored = prefs.getString(ITEM, null) ?: return null
        // The Keystore key is gone (the app's data was moved to another phone): what's stored can
        // never be opened again, so start over rather than fail every time.
        if (!keyStore().containsAlias(KEY_ALIAS)) {
            prefs.edit().remove(ITEM).commit()
            return null
        }
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes, 0, 12))
        return try {
            String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
        } catch (e: AEADBadTagException) {
            prefs.edit().remove(ITEM).commit()
            null
        }
    }

    /** Saves the map's JSON; null deletes it. */
    @Synchronized
    fun write(context: Context, text: String?) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (text == null) {
            prefs.edit().remove(ITEM).commit()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val sealed = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        if (!prefs.edit().putString(ITEM, Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) {
            throw LacticError("Couldn't save the keys on this phone")
        }
    }
}
