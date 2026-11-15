// What goes over the wire between the phone and the computer: a sealed envelope out, a sealed
// reply back. The same layout as the iPhone's Wire.swift and the computer's phone.rs: JSON
// `{t, kind, body}` sealed with AES-256-GCM as nonce (12 bytes) + ciphertext + tag (16 bytes).

package fit.lactic.phone

import android.util.Base64
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.databind.node.ObjectNode
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

val json: ObjectMapper = ObjectMapper()
val nodes: JsonNodeFactory = JsonNodeFactory.instance

/** A message for the rider: shown as it is. */
class LacticError(message: String) : Exception(message)

object Wire {
    private val random = SecureRandom()

    fun b64url(data: ByteArray): String = Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    fun fromB64url(text: String): ByteArray? = try {
        Base64.decode(text, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
        null
    }

    fun seal(plain: ByteArray, key: ByteArray): ByteArray {
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return nonce + cipher.doFinal(plain)
    }

    fun open(sealed: ByteArray, key: ByteArray): ByteArray {
        if (sealed.size < 12 + 16) throw LacticError("The computer's answer was cut short")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, sealed, 0, 12))
        return cipher.doFinal(sealed, 12, sealed.size - 12)
    }

    /** `{t, kind, body}` sealed. `t` is whole milliseconds since 1970. */
    fun request(kind: String, body: JsonNode, key: ByteArray, now: Long = System.currentTimeMillis()): ByteArray {
        val envelope: ObjectNode = nodes.objectNode()
        envelope.put("t", now)
        envelope.put("kind", kind)
        envelope.set<JsonNode>("body", body)
        return seal(json.writeValueAsBytes(envelope), key)
    }

    /** The computer's sealed answer: `{ok: true, body}` or `{ok: false, error}`. */
    fun reply(data: ByteArray, key: ByteArray): JsonNode = json.readTree(open(data, key))
}
