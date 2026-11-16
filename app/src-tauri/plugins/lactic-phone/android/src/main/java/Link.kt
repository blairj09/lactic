// The link to the paired computer: one sealed POST to /lactic/phone, the answer sealed back. It
// tries where the computer answered last, then every address the pairing code listed. Android has
// no AirDrop-style link and no iCloud, so phone and computer need to share a network (home Wi-Fi).

package fit.lactic.phone

import com.fasterxml.jackson.databind.JsonNode
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

object Link {
    /** The computer answered `{ok: false, error}`: it was reached, so the request ends there. */
    private class ComputerSaid(message: String) : Exception(message)

    /** Seals `kind` + `body`, sends it to the computer, and opens the reply. Updates `pairing` (where it answered). Blocking. */
    fun send(pairing: Pairing, kind: String, body: JsonNode, timeoutSeconds: Double = 30.0): JsonNode {
        val key = Wire.fromB64url(pairing.key) ?: throw LacticError("The pairing key is damaged. Pair again.")
        val sealed = Wire.request(kind, body, key)
        val computer = pairing.computer

        fun post(host: String, timeout: Double): JsonNode {
            val h = if (host.contains(':')) "[$host]" else host
            val conn = URL("http://$h:${pairing.port}/lactic/phone").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = (minOf(timeout, 5.0) * 1000).toInt()
                conn.readTimeout = (timeout * 1000).toInt()
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.setRequestProperty("X-Lactic-Device", pairing.deviceId)
                conn.setFixedLengthStreamingMode(sealed.size)
                conn.outputStream.use { it.write(sealed) }
                val status = conn.responseCode
                if (status == 401) throw LacticError("$computer doesn't know this phone anymore. Pair again from Lactic's Settings on the computer.")
                if (status != 200) throw LacticError("$computer answered $status")
                val data = conn.inputStream.use { it.readBytes() }
                val reply = Wire.reply(data, key)
                if (reply.path("ok").asBoolean(false)) return reply.path("body")
                throw ComputerSaid(reply.path("error").asText("$computer couldn't do that"))
            } finally {
                conn.disconnect()
            }
        }

        var lastError: Exception? = null
        val order = buildList {
            pairing.lastHost?.takeIf { it in pairing.hosts }?.let { add(it) }
            pairing.hosts.filterTo(this) { it != pairing.lastHost }
        }
        for ((i, host) in order.withIndex()) {
            try {
                // The address that answered last time gets a quick try; the rest the full time.
                val v = post(host, if (i == 0 && host == pairing.lastHost) minOf(timeoutSeconds, 4.0) else timeoutSeconds)
                pairing.lastHost = host
                pairing.lastSentAt = System.currentTimeMillis().toDouble()
                return v
            } catch (e: ComputerSaid) {
                pairing.lastHost = host
                pairing.lastSentAt = System.currentTimeMillis().toDouble()
                throw LacticError(e.message ?: "$computer couldn't do that")
            } catch (e: LacticError) {
                throw e
            } catch (e: IOException) {
                lastError = e // Not at this address: try the next.
            } catch (e: javax.crypto.AEADBadTagException) {
                throw LacticError("$computer's answer couldn't be opened. Pair again.")
            }
        }
        val tried = pairing.hosts.joinToString(", ")
        val mine = wifiAddress()
        if (lastError != null && mine != null && pairing.hosts.none { sameNetwork(mine, it) } && pairing.hosts.any { it.matches(Regex("""\d+\.\d+\.\d+\.\d+""")) }) {
            throw LacticError("This phone and $computer are on different networks: the phone is ${mine.first}, the computer is $tried. Join the phone to the same Wi-Fi as the computer, then try again.")
        }
        throw LacticError("Can't reach $computer (tried $tried, port ${pairing.port}). Check that Lactic is open on it, that both are on the same Wi-Fi, and that the computer's firewall lets Lactic accept connections.")
    }

    /** This phone's own IPv4 address and prefix length on Wi-Fi (or any LAN), to tell "different network" apart from "not answering". */
    private fun wifiAddress(): Pair<String, Int>? = try {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback && (it.name.startsWith("wlan") || it.name.startsWith("eth")) }
            .flatMap { it.interfaceAddresses }
            .firstOrNull { it.address is Inet4Address }
            ?.let { Pair(it.address.hostAddress ?: "", it.networkPrefixLength.toInt()) }
    } catch (e: Exception) {
        null
    }

    private fun ipv4(s: String): Long? {
        val parts = s.split('.')
        if (parts.size != 4) return null
        var out = 0L
        for (p in parts) {
            val n = p.toIntOrNull() ?: return null
            if (n !in 0..255) return null
            out = (out shl 8) or n.toLong()
        }
        return out
    }

    private fun sameNetwork(mine: Pair<String, Int>, host: String): Boolean {
        val a = ipv4(mine.first) ?: return false
        val b = ipv4(host) ?: return false
        val mask = if (mine.second <= 0) 0L else (0xFFFFFFFFL shl (32 - mine.second)) and 0xFFFFFFFFL
        return (a and mask) == (b and mask)
    }
}
