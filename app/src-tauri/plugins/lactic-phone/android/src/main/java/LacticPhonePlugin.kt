// Lactic on Android: Health Connect, Bluetooth, and the link to the rider's computer. The same
// commands as the iPhone's Swift plugin (ios/Sources/LacticPhonePlugin.swift), so the web layer
// (src/phone/plugin.ts) is the same on both; Android adds the ble_* commands, because btleplug
// can't run here (src/bluetooth/backend.ts sends Bluetooth to this plugin on Android).
//
// Health: reads in the Shortcut's column format (Health.kt), a background read about every 15
// minutes when recovery data changed (HealthWorker.kt), rides written as cycling sessions.
// The computer: the pairing key from its QR code, kept encrypted under an Android Keystore key
// (Pairing.kt); every request sealed with AES-256-GCM and posted over the local network (Link.kt).

package fit.lactic.phone

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.PermissionController
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.databind.JsonNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@InvokeArg
class ReadArgs {
    var days: Int? = null
}

@InvokeArg
class AckArgs {
    var ids: List<String> = emptyList()
}

@InvokeArg
class PairArgs {
    var url: String = ""
}

@InvokeArg
class SendArgs {
    var kind: String = ""
    var body: JsonNode? = null
    var timeout: Double? = null
}

@InvokeArg
@JsonIgnoreProperties(ignoreUnknown = true)
class WorkoutArgs {
    var id: String = ""
    var name: String? = null
    /** Unix seconds. */
    var start: Double = 0.0
    var end: Double = 0.0
    var indoor: Boolean = true
    var kcal: Double? = null
    var distanceMeters: Double? = null
    /** [seconds from start, value] pairs. */
    var heartRate: List<List<Double>>? = null
    var power: List<List<Double>>? = null
    var cadence: List<List<Double>>? = null
}

@InvokeArg
class BleIdArgs {
    var id: String = ""
}

@InvokeArg
class BleCharArgs {
    var id: String = ""
    var service: String = ""
    var characteristic: String = ""
    var on: Boolean = false
    var value: List<Int>? = null
    var withResponse: Boolean = true
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "bluetoothLegacy"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class LacticPhonePlugin(private val activity: Activity) : Plugin(activity) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val ctx get() = activity.applicationContext
    private val ble by lazy { Ble(ctx) { event, payload -> triggerObject(event, payload) } }
    private val prefs get() = ctx.getSharedPreferences("lactic.phone", Activity.MODE_PRIVATE)

    companion object {
        private const val ASKED = "health.asked"

        /** The running plugin, for background reads to tell the open app. */
        @Volatile
        var current: LacticPhonePlugin? = null
    }

    init {
        current = this
        // Every launch: keep the background read going once the rider has connected Health Connect.
        if (prefs.getBoolean(ASKED, false)) HealthWorker.schedule(ctx)
    }

    fun healthArrived(id: String) {
        triggerObject("health", mapOf("pending" to id))
    }

    /** Runs `work` off the main thread and answers with what it returns, or its error. */
    private fun answer(invoke: Invoke, work: suspend () -> Any?) {
        scope.launch {
            try {
                when (val v = work()) {
                    null, Unit -> invoke.resolve()
                    else -> invoke.resolveObject(v)
                }
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    // --- Status and Health Connect -------------------------------------------------------------

    @Command
    fun status(invoke: Invoke) {
        answer(invoke) {
            val p = PairingStore.load(ctx)
            mapOf(
                "healthAvailable" to Health.available(ctx),
                "healthAsked" to prefs.getBoolean(ASKED, false),
                "healthInstall" to Health.needsInstall(ctx),
                "pending" to Queue.list(ctx).size,
                "paired" to p?.let { mapOf("computer" to it.computer, "deviceId" to it.deviceId, "lastSentAt" to it.lastSentAt) },
            )
        }
    }

    @Command
    fun authorizeHealth(invoke: Invoke) {
        if (!Health.available(ctx)) {
            if (Health.needsInstall(ctx)) {
                // Android 13 and older: Health Connect comes from the Play Store.
                val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${Health.PROVIDER}&url=healthconnect%3A%2F%2Fonboarding"))
                    .setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { activity.startActivity(market) } catch (e: Exception) {}
                return invoke.reject("Install or update Health Connect from the Play Store, then come back and connect it.")
            }
            return invoke.reject("Health Connect isn't available on this phone")
        }
        val intent = PermissionController.createRequestPermissionResultContract(Health.PROVIDER).createIntent(activity, Health.permissions)
        startActivityForResult(invoke, intent, "healthAuthorized")
    }

    @ActivityCallback
    private fun healthAuthorized(invoke: Invoke, result: ActivityResult) {
        prefs.edit().putBoolean(ASKED, true).apply()
        HealthWorker.schedule(ctx)
        answer(invoke) {
            // What Health Connect says was allowed, not just this sheet's answer.
            mapOf("granted" to Health.granted(ctx).any { it.startsWith("android.permission.health.READ_") })
        }
    }

    @Command
    fun readHealth(invoke: Invoke) {
        val args = invoke.parseArgs(ReadArgs::class.java)
        answer(invoke) { Health.read(ctx, (args.days ?: 3).coerceIn(1, 400)) }
    }

    @Command
    fun takePending(invoke: Invoke) {
        answer(invoke) { Queue.list(ctx).mapNotNull { id -> Queue.read(ctx, id)?.let { mapOf("id" to id, "body" to it) } } }
    }

    @Command
    fun ackPending(invoke: Invoke) {
        val args = invoke.parseArgs(AckArgs::class.java)
        args.ids.forEach { Queue.remove(ctx, it) }
        invoke.resolve()
    }

    @Command
    fun saveWorkout(invoke: Invoke) {
        val args = invoke.parseArgs(WorkoutArgs::class.java)
        answer(invoke) {
            val r = Health.save(ctx, args)
            mapOf("saved" to r.saved, "reason" to r.reason)
        }
    }

    // --- The computer --------------------------------------------------------------------------

    private fun phoneName(): String =
        Settings.Global.getString(activity.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
            ?: "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

    @Command
    fun pair(invoke: Invoke) {
        val args = invoke.parseArgs(PairArgs::class.java)
        answer(invoke) {
            val pairing = Pairing.parse(args.url)
            val reply = Link.send(pairing, "hello", nodes.objectNode().put("name", phoneName()), 8.0)
            reply.path("computer").takeIf { it.isTextual }?.let { pairing.computer = it.asText() }
            PairingStore.save(ctx, pairing)
            mapOf("computer" to pairing.computer)
        }
    }

    @Command
    fun unpair(invoke: Invoke) {
        PairingStore.clear(ctx)
        invoke.resolve()
    }

    @Command
    fun send(invoke: Invoke) {
        val args = invoke.parseArgs(SendArgs::class.java)
        answer(invoke) {
            val pairing = PairingStore.load(ctx) ?: throw LacticError("This phone isn't paired with a computer yet")
            try {
                Link.send(pairing, args.kind, args.body ?: nodes.nullNode(), args.timeout ?: 60.0)
            } finally {
                PairingStore.save(ctx, pairing)
            }
        }
    }

    // --- The end of a ride on the computer -----------------------------------------------------

    @Command
    fun scheduleRideEnd(invoke: Invoke) {
        val args = invoke.parseArgs(RideEndArgs::class.java)
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            return requestPermissionForAlias("notifications", invoke, "notificationsAnswered")
        }
        RideEnd.schedule(ctx, args)
        invoke.resolve()
    }

    @PermissionCallback
    private fun notificationsAnswered(invoke: Invoke) {
        // Scheduled either way: without permission it just doesn't show.
        RideEnd.schedule(ctx, invoke.parseArgs(RideEndArgs::class.java))
        invoke.resolve()
    }

    @Command
    fun cancelRideEnd(invoke: Invoke) {
        RideEnd.cancel(ctx)
        invoke.resolve()
    }

    // --- Bluetooth -----------------------------------------------------------------------------

    private val bleAlias get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "bluetooth" else "bluetoothLegacy"

    /** Runs `then` once Nearby devices (or, before Android 12, location) is allowed; asks first if needed. */
    private fun withBluetooth(invoke: Invoke, then: () -> Unit) {
        if (getPermissionState(bleAlias) == PermissionState.GRANTED) return then()
        requestPermissionForAlias(bleAlias, invoke, "bluetoothAnswered")
    }

    @PermissionCallback
    private fun bluetoothAnswered(invoke: Invoke) {
        if (getPermissionState(bleAlias) != PermissionState.GRANTED) {
            return invoke.reject("Lactic needs the Nearby devices permission to find your trainer and sensors. Allow it in Settings → Apps → Lactic → Permissions.")
        }
        when (invoke.command) {
            "bleScan" -> bleScan(invoke)
            "bleConnect" -> bleConnect(invoke)
            else -> invoke.resolve()
        }
    }

    @Command
    fun bleAvailable(invoke: Invoke) {
        val (ok, reason) = ble.availability()
        invoke.resolveObject(mapOf("available" to ok, "reason" to reason))
    }

    @Command
    fun bleScan(invoke: Invoke) = withBluetooth(invoke) { answer(invoke) { ble.scan() } }

    @Command
    fun bleStopScan(invoke: Invoke) = answer(invoke) { ble.stopScan() }

    @Command
    fun bleConnect(invoke: Invoke) = withBluetooth(invoke) {
        val args = invoke.parseArgs(BleIdArgs::class.java)
        answer(invoke) { ble.connect(args.id) }
    }

    @Command
    fun bleDisconnect(invoke: Invoke) {
        val args = invoke.parseArgs(BleIdArgs::class.java)
        answer(invoke) { ble.disconnect(args.id) }
    }

    @Command
    fun bleSubscribe(invoke: Invoke) {
        val a = invoke.parseArgs(BleCharArgs::class.java)
        answer(invoke) { ble.subscribe(a.id, a.service, a.characteristic, a.on) }
    }

    @Command
    fun bleWrite(invoke: Invoke) {
        val a = invoke.parseArgs(BleCharArgs::class.java)
        answer(invoke) { ble.write(a.id, a.service, a.characteristic, (a.value ?: emptyList()).map { it.toByte() }.toByteArray(), a.withResponse) }
    }

    @Command
    fun bleRead(invoke: Invoke) {
        val a = invoke.parseArgs(BleCharArgs::class.java)
        answer(invoke) { ble.read(a.id, a.service, a.characteristic).map { it.toInt() and 0xff } }
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        ble.closeAll()
        if (current === this) current = null
    }
}
