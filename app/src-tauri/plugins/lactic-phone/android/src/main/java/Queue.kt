// Health bodies read in the background, waiting for the app to import them next time it opens
// (they also go straight to the paired computer when it can be reached).

package fit.lactic.phone

import android.content.Context
import com.fasterxml.jackson.databind.JsonNode
import java.io.File
import java.util.UUID

object Queue {
    private fun dir(context: Context): File = File(context.filesDir, "lactic-phone/pending").apply { mkdirs() }

    fun add(context: Context, body: JsonNode): String {
        val id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}"
        File(dir(context), "$id.json").writeBytes(json.writeValueAsBytes(body))
        // Only the newest few matter: each one holds the last three days.
        list(context).dropLast(20).forEach { remove(context, it) }
        return id
    }

    fun list(context: Context): List<String> =
        dir(context).listFiles().orEmpty().map { it.name }.filter { it.endsWith(".json") }.map { it.removeSuffix(".json") }.sorted()

    fun read(context: Context, id: String): JsonNode? = try {
        json.readTree(File(dir(context), "$id.json"))
    } catch (e: Exception) {
        null
    }

    fun remove(context: Context, id: String) {
        File(dir(context), "$id.json").delete()
    }
}
