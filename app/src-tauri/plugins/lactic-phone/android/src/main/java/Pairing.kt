// The pairing with the computer: its key, addresses and name. Kept in the app's private
// preferences, encrypted under a key that never leaves the Android Keystore, so it can't be read
// off the phone's storage or restored onto another phone.

package fit.lactic.phone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import java.net.URLDecoder
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@JsonIgnoreProperties(ignoreUnknown = true)
data class Pairing(
    var deviceId: String = "",
    var key: String = "",
    var hosts: List<String> = emptyList(),
    var port: Int = 0,
    var computer: String = "your computer",
    var lastHost: String? = null,
    var lastSentAt: Double? = null,
) {
    companion object {
        /** The QR code's link: https://lactic.fit/pair#v=1&d=<device>&k=<key>&p=<port>&h=<host,host>&n=<name> */
        fun parse(url: String): Pairing {
            val hash = url.substringAfter('#', "")
            if (hash.isEmpty()) throw LacticError("That isn't a Lactic pairing code")
            val fields = HashMap<String, String>()
            for (part in hash.split('&')) {
                val kv = part.split('=', limit = 2)
                if (kv.size == 2) fields[kv[0]] = decode(kv[1])
            }
            val d = fields["d"]
            val k = fields["k"]
            val p = fields["p"]?.toIntOrNull()
            if (d == null || k == null || p == null || Wire.fromB64url(k)?.size != 32) throw LacticError("That isn't a Lactic pairing code")
            val hosts = (fields["h"] ?: "").split(',').filter { it.isNotEmpty() }.map(::decode)
            return Pairing(deviceId = d, key = k, hosts = hosts, port = p, computer = fields["n"] ?: "your computer")
        }

        private fun decode(s: String): String = try {
            URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")
        } catch (e: Exception) {
            s
        }
    }
}

object PairingStore {
    private const val PREFS = "lactic.phone"
    private const val ITEM = "pairing"
    private const val KEY_ALIAS = "lactic-pairing"

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
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

    @Synchronized
    fun load(context: Context): Pairing? {
        val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ITEM, null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes, 0, 12))
            json.readValue(cipher.doFinal(bytes, 12, bytes.size - 12), Pairing::class.java)
        } catch (e: Exception) {
            null
        }
    }

    @Synchronized
    fun save(context: Context, p: Pairing) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val sealed = cipher.iv + cipher.doFinal(json.writeValueAsBytes(p))
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ITEM, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(ITEM).apply()
    }
}
