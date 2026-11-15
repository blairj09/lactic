// Bluetooth LE on Android: trainers, heart rate straps, power meters and scales. The same commands
// and events as the core's ble.rs on the other platforms (src/bluetooth/backend.ts wraps both), so
// the same SensorHub and scale code run on top.
//
// Android's GATT allows one operation at a time per device: every read, write and subscribe for a
// device holds that device's lock until its callback answers.

package fit.lactic.phone

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ArrayNode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

// The plugin asks for Nearby devices before any of this runs. The older calls are for Android 12 and before.
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class Ble(private val context: Context, private val emit: (String, JsonNode) -> Unit) {
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
    private val adapter get() = manager?.adapter
    private val seen = ConcurrentHashMap<String, BluetoothDevice>()
    private val connections = ConcurrentHashMap<String, Conn>()
    private var scanning = 0
    private val scanLock = Any()

    fun availability(): Pair<Boolean, String?> {
        val a = adapter ?: return false to "This phone has no Bluetooth"
        if (!context.packageManager.hasSystemFeature("android.hardware.bluetooth_le")) return false to "This phone doesn't have Bluetooth LE"
        if (!a.isEnabled) return false to "Bluetooth is off. Turn it on in the quick settings."
        return true to null
    }

    // --- Scanning ------------------------------------------------------------------------------

    private fun bytes(data: ByteArray?): ArrayNode {
        val arr = nodes.arrayNode()
        data?.forEach { arr.add(it.toInt() and 0xff) }
        return arr
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = advert(result)
        override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::advert)
    }

    private fun advert(r: ScanResult) {
        val d = r.device
        seen[d.address] = d
        val rec = r.scanRecord
        val ad = nodes.objectNode()
        ad.put("id", d.address)
        val name = rec?.deviceName ?: try { d.name } catch (e: SecurityException) { null }
        if (name != null) ad.put("name", name) else ad.putNull("name")
        ad.put("rssi", r.rssi)
        val services = ad.putArray("services")
        rec?.serviceUuids?.forEach { services.add(it.uuid.toString()) }
        val sd = ad.putObject("serviceData")
        rec?.serviceData?.forEach { (uuid, data) -> sd.set<JsonNode>(uuid.uuid.toString(), bytes(data)) }
        val md = ad.putObject("manufacturerData")
        rec?.manufacturerSpecificData?.let { sparse ->
            for (i in 0 until sparse.size()) md.set<JsonNode>(sparse.keyAt(i).toString(), bytes(sparse.valueAt(i)))
        }
        emit("ble-advert", ad)
    }

    /** Scans nest: each start needs a stop. */
    fun scan() {
        val a = adapter ?: throw LacticError("This phone has no Bluetooth")
        if (!a.isEnabled) throw LacticError("Bluetooth is off. Turn it on in the quick settings.")
        synchronized(scanLock) {
            if (scanning == 0) {
                val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
                a.bluetoothLeScanner?.startScan(null, settings, scanCallback) ?: throw LacticError("Bluetooth is off. Turn it on in the quick settings.")
            }
            scanning++
        }
    }

    fun stopScan() {
        synchronized(scanLock) {
            if (scanning == 0) return
            scanning--
            if (scanning == 0) try { adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (e: Exception) {}
        }
    }

    // --- Connections ---------------------------------------------------------------------------

    private inner class Conn(val id: String) : BluetoothGattCallback() {
        var gatt: BluetoothGatt? = null
        val lock = Mutex()
        val connected = CompletableDeferred<Unit>()
        val discovered = CompletableDeferred<Int>()
        @Volatile var pending: CompletableDeferred<Pair<Int, ByteArray?>>? = null
        @Volatile var mtu: CompletableDeferred<Unit>? = null
        @Volatile var closed = false

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                connected.complete(Unit)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                drop(status)
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            this.mtu?.complete(Unit)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            discovered.complete(status)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            pending?.complete(status to null)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            pending?.complete(status to null)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            pending?.complete(status to value)
        }

        @Deprecated("Android 12 and older")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                pending?.complete(status to c.value)
            }
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            notify(c, value)
        }

        @Deprecated("Android 12 and older")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                notify(c, c.value ?: ByteArray(0))
            }
        }

        private fun notify(c: BluetoothGattCharacteristic, value: ByteArray) {
            val n = nodes.objectNode()
            n.put("id", id)
            n.put("service", c.service.uuid.toString())
            n.put("characteristic", c.uuid.toString())
            n.set<JsonNode>("value", bytes(value))
            emit("ble-notify", n)
        }

        fun drop(status: Int) {
            if (closed) return
            closed = true
            val why = LacticError("The device disconnected (status $status)")
            connected.completeExceptionally(why)
            discovered.completeExceptionally(why)
            pending?.completeExceptionally(why)
            mtu?.complete(Unit)
            try { gatt?.close() } catch (e: Exception) {}
            connections.remove(id, this)
            emit("ble-disconnected", nodes.objectNode().put("id", id))
        }

        /** One GATT operation: starts it, then waits for its callback. */
        suspend fun op(what: String, start: (BluetoothGatt) -> Boolean): ByteArray? = lock.withLock {
            val g = gatt ?: throw LacticError("Not connected")
            if (closed) throw LacticError("Not connected")
            val done = CompletableDeferred<Pair<Int, ByteArray?>>()
            pending = done
            try {
                if (!start(g)) throw LacticError("Couldn't $what: the device is busy or doesn't allow it")
                val (status, value) = withTimeout(10_000) { done.await() }
                if (status != BluetoothGatt.GATT_SUCCESS) throw LacticError("Couldn't $what (status $status)")
                value
            } finally {
                pending = null
            }
        }
    }

    private fun props(c: BluetoothGattCharacteristic): ArrayNode {
        val out = nodes.arrayNode()
        val p = c.properties
        if (p and BluetoothGattCharacteristic.PROPERTY_READ != 0) out.add("read")
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) out.add("write")
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) out.add("writeWithoutResponse")
        if (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) out.add("notify")
        if (p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) out.add("indicate")
        return out
    }

    private fun services(g: BluetoothGatt): ArrayNode {
        val out = nodes.arrayNode()
        for (s in g.services) {
            val so = out.addObject()
            so.put("uuid", s.uuid.toString())
            val chars = so.putArray("characteristics")
            for (c in s.characteristics) {
                val co = chars.addObject()
                co.put("uuid", c.uuid.toString())
                co.set<JsonNode>("properties", props(c))
            }
        }
        return out
    }

    /** The device with this id: seen this run, or scanned for (a remembered one wakes up when pedalled). */
    private suspend fun find(id: String): BluetoothDevice {
        seen[id]?.let { return it }
        val a = adapter ?: throw LacticError("This phone has no Bluetooth")
        scan()
        try {
            withTimeoutOrNull(10_000) {
                while (seen[id] == null) delay(250)
            }
        } finally {
            stopScan()
        }
        seen[id]?.let { return it }
        if (!android.bluetooth.BluetoothAdapter.checkBluetoothAddress(id)) throw LacticError("Device not found")
        return a.getRemoteDevice(id)
    }

    suspend fun connect(id: String): JsonNode {
        connections[id]?.let { c ->
            if (!c.closed && c.discovered.isCompleted) return services(c.gatt!!)
            disconnect(id) // Half connected: start over.
        }
        val device = find(id)
        val conn = Conn(id)
        connections[id] = conn
        conn.gatt = device.connectGatt(context, false, conn, BluetoothDevice.TRANSPORT_LE)
            ?: throw LacticError("Couldn't connect. Is Bluetooth on?")
        try {
            withTimeout(20_000) { conn.connected.await() }
            // Room for whole FTMS and scale messages; fine if the device says no.
            conn.mtu = CompletableDeferred<Unit>().also { d ->
                if (conn.gatt!!.requestMtu(247)) withTimeoutOrNull(3_000) { d.await() }
            }
            conn.mtu = null
            if (!conn.gatt!!.discoverServices()) throw LacticError("Couldn't read the device's services")
            val status = withTimeout(20_000) { conn.discovered.await() }
            if (status != BluetoothGatt.GATT_SUCCESS) throw LacticError("Couldn't read the device's services (status $status)")
            return services(conn.gatt!!)
        } catch (e: Exception) {
            disconnect(id)
            if (e is LacticError) throw e
            throw LacticError("Device not found. Wake it up (pedal, put the strap on, or step on the scale) and try again.")
        }
    }

    fun disconnect(id: String) {
        val c = connections[id] ?: return
        try { c.gatt?.disconnect() } catch (e: Exception) {}
        c.drop(0)
    }

    fun isConnected(id: String): Boolean = connections[id]?.let { !it.closed && it.discovered.isCompleted } == true

    private fun conn(id: String): Conn = connections[id]?.takeIf { !it.closed } ?: throw LacticError("Not connected")

    private fun characteristic(c: Conn, service: String, uuid: String): BluetoothGattCharacteristic =
        c.gatt?.getService(UUID.fromString(service))?.getCharacteristic(UUID.fromString(uuid))
            ?: throw LacticError("Characteristic $uuid not found")

    suspend fun subscribe(id: String, service: String, characteristic: String, on: Boolean) {
        val c = conn(id)
        val ch = characteristic(c, service, characteristic)
        val cccd = ch.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
            ?: throw LacticError("That characteristic doesn't send updates")
        val value = when {
            !on -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            ch.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0 -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        }
        c.op(if (on) "subscribe" else "unsubscribe") { g ->
            if (!g.setCharacteristicNotification(ch, on)) return@op false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
            } else {
                cccd.value = value
                g.writeDescriptor(cccd)
            }
        }
    }

    suspend fun write(id: String, service: String, characteristic: String, value: ByteArray, withResponse: Boolean) {
        val c = conn(id)
        val ch = characteristic(c, service, characteristic)
        val type = if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        c.op("write") { g ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeCharacteristic(ch, value, type) == BluetoothStatusCodes.SUCCESS
            } else {
                ch.writeType = type
                ch.value = value
                g.writeCharacteristic(ch)
            }
        }
    }

    suspend fun read(id: String, service: String, characteristic: String): ByteArray {
        val c = conn(id)
        val ch = characteristic(c, service, characteristic)
        return c.op("read") { g -> g.readCharacteristic(ch) } ?: ByteArray(0)
    }

    fun closeAll() {
        connections.keys.toList().forEach(::disconnect)
        synchronized(scanLock) {
            if (scanning > 0) try { adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (e: Exception) {}
            scanning = 0
        }
    }
}
