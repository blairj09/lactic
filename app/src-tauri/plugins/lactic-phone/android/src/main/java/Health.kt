// Health Connect, Android's shared health store (built in from Android 14, an app before that).
// Reads sleep, HRV, resting heart rate, breathing, heart rate, active energy, steps and VO2 max,
// and hands them over in the same column format the Lactic Shortcut and the iPhone's HealthKit
// reader use (sleepStart / sleepEnd / sleepValue, hrvDate / hrvValue, ...), so the engine's
// health-import reads every source the same way. Health Connect keeps HRV as RMSSD (Apple keeps
// SDNN), which the body says (`hrvKind`). Rides go the other way, as cycling sessions.

package fit.lactic.phone

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Power
import com.fasterxml.jackson.databind.node.ObjectNode
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.reflect.KClass

object Health {
    const val PROVIDER = "com.google.android.apps.healthdata"

    private val readTypes: List<KClass<out Record>> = listOf(
        SleepSessionRecord::class,
        HeartRateVariabilityRmssdRecord::class,
        RestingHeartRateRecord::class,
        RespiratoryRateRecord::class,
        HeartRateRecord::class,
        ActiveCaloriesBurnedRecord::class,
        StepsRecord::class,
        Vo2MaxRecord::class,
        ExerciseSessionRecord::class,
    )

    private val writeTypes: List<KClass<out Record>> = listOf(
        ExerciseSessionRecord::class,
        HeartRateRecord::class,
        PowerRecord::class,
        CyclingPedalingCadenceRecord::class,
        ActiveCaloriesBurnedRecord::class,
        DistanceRecord::class,
    )

    /** Types whose changes are worth a background read: the ones a recovery score needs. */
    val wakeTypes: Set<KClass<out Record>> = setOf(SleepSessionRecord::class, HeartRateVariabilityRmssdRecord::class, RestingHeartRateRecord::class)

    val permissions: Set<String> =
        readTypes.map { HealthPermission.getReadPermission(it) }.toSet() +
            writeTypes.map { HealthPermission.getWritePermission(it) } +
            HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    fun available(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context, PROVIDER) == HealthConnectClient.SDK_AVAILABLE

    /** Health Connect is there but needs installing or updating (Android 13 and older). */
    fun needsInstall(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context, PROVIDER) == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED

    fun client(context: Context): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    suspend fun granted(context: Context): Set<String> = client(context).permissionController.getGrantedPermissions()

    private fun iso(t: Instant): String =
        DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(t.truncatedTo(ChronoUnit.SECONDS).atZone(ZoneId.systemDefault()))

    private suspend fun <T : Record> all(client: HealthConnectClient, type: KClass<T>, since: Instant): List<T> {
        val out = ArrayList<T>()
        var token: String? = null
        do {
            val page = client.readRecords(ReadRecordsRequest(recordType = type, timeRangeFilter = TimeRangeFilter.after(since), pageToken = token))
            out.addAll(page.records)
            token = page.pageToken
        } while (!token.isNullOrEmpty())
        return out
    }

    private fun stageName(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "Awake"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "In Bed"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "Core"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "Deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "REM"
        else -> "Asleep"
    }

    /** The last `days` days, as the Shortcut's columns. Heart rate (a lot of samples) is capped at 14 days. Types not allowed are left out. */
    suspend fun read(context: Context, days: Int): ObjectNode {
        val client = client(context)
        val allowed = granted(context)
        fun can(type: KClass<out Record>) = HealthPermission.getReadPermission(type) in allowed
        val now = Instant.now()
        val since = now.minus(Duration.ofDays(days.toLong()))
        val hrSince = now.minus(Duration.ofDays(minOf(days, 14).toLong()))
        val body = nodes.objectNode()
        body.put("hrvKind", "rmssd")
        body.put("source", "healthconnect")
        fun put(key: String, values: List<String>) {
            val a = body.putArray(key)
            values.forEach { a.add(it) }
        }

        if (can(SleepSessionRecord::class)) {
            val starts = ArrayList<String>()
            val ends = ArrayList<String>()
            val values = ArrayList<String>()
            for (s in all(client, SleepSessionRecord::class, since)) {
                if (s.stages.isEmpty()) {
                    starts.add(iso(s.startTime)); ends.add(iso(s.endTime)); values.add("Asleep")
                } else {
                    for (st in s.stages) {
                        starts.add(iso(st.startTime)); ends.add(iso(st.endTime)); values.add(stageName(st.stage))
                    }
                }
            }
            put("sleepStart", starts); put("sleepEnd", ends); put("sleepValue", values)
        }
        if (can(HeartRateVariabilityRmssdRecord::class)) {
            val list = all(client, HeartRateVariabilityRmssdRecord::class, since)
            put("hrvDate", list.map { iso(it.time) }); put("hrvValue", list.map { it.heartRateVariabilityMillis.toString() })
        }
        if (can(RestingHeartRateRecord::class)) {
            val list = all(client, RestingHeartRateRecord::class, since)
            put("restingHrDate", list.map { iso(it.time) }); put("restingHrValue", list.map { it.beatsPerMinute.toString() })
        }
        if (can(RespiratoryRateRecord::class)) {
            val list = all(client, RespiratoryRateRecord::class, since)
            put("respRateDate", list.map { iso(it.time) }); put("respRateValue", list.map { it.rate.toString() })
        }
        if (can(HeartRateRecord::class)) {
            val samples = all(client, HeartRateRecord::class, hrSince).flatMap { it.samples }.sortedBy { it.time }
            put("heartRateDate", samples.map { iso(it.time) }); put("heartRateValue", samples.map { it.beatsPerMinute.toString() })
        }
        if (can(Vo2MaxRecord::class)) {
            val list = all(client, Vo2MaxRecord::class, since)
            put("vo2maxDate", list.map { iso(it.time) }); put("vo2maxValue", list.map { it.vo2MillilitersPerMinuteKilogram.toString() })
        }
        // One total per local day, with each data source counted once (Health Connect merges them).
        val zone = ZoneId.systemDefault()
        val firstDay = LocalDate.now(zone).minusDays(days.toLong()).atStartOfDay()
        val tomorrow = LocalDate.now(zone).plusDays(1).atStartOfDay()
        fun dayIso(d: java.time.LocalDateTime) = DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(d.atZone(zone))
        if (can(ActiveCaloriesBurnedRecord::class)) {
            val groups = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL), TimeRangeFilter.between(firstDay, tomorrow), Period.ofDays(1)))
            val withData = groups.mapNotNull { g -> g.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { g.startTime to it.inKilocalories } }
            put("activeEnergyDate", withData.map { dayIso(it.first) }); put("activeEnergyValue", withData.map { it.second.toString() })
        }
        if (can(StepsRecord::class)) {
            val groups = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(firstDay, tomorrow), Period.ofDays(1)))
            val withData = groups.mapNotNull { g -> g.result[StepsRecord.COUNT_TOTAL]?.let { g.startTime to it } }
            put("stepsDate", withData.map { dayIso(it.first) }); put("stepsValue", withData.map { it.second.toString() })
        }
        return body
    }

    // --- Changes, for background reads ---------------------------------------------------------

    private const val TOKEN = "health.changesToken"

    /** Whether recovery data changed since the last call (true the first time). */
    suspend fun changed(context: Context): Boolean {
        val client = client(context)
        val prefs = context.getSharedPreferences("lactic.phone", Context.MODE_PRIVATE)
        val readable = wakeTypes.filter { HealthPermission.getReadPermission(it) in granted(context) }.toSet()
        if (readable.isEmpty()) return false
        val token = prefs.getString(TOKEN, null)
        if (token == null) {
            prefs.edit().putString(TOKEN, client.getChangesToken(ChangesTokenRequest(readable))).apply()
            return true
        }
        var next: String = token
        var any = false
        try {
            do {
                val r = client.getChanges(next)
                if (r.changesTokenExpired) {
                    prefs.edit().putString(TOKEN, client.getChangesToken(ChangesTokenRequest(readable))).apply()
                    return true
                }
                any = any || r.changes.isNotEmpty()
                next = r.nextChangesToken
                if (!r.hasMore) break
            } while (true)
        } catch (e: Exception) {
            // A token for a different set of types (permissions changed): start again.
            prefs.edit().putString(TOKEN, client.getChangesToken(ChangesTokenRequest(readable))).apply()
            return true
        }
        prefs.edit().putString(TOKEN, next).apply()
        return any
    }

    // --- Rides into Health Connect -------------------------------------------------------------

    class Saved(val saved: Boolean, val reason: String?)

    suspend fun save(context: Context, w: WorkoutArgs): Saved {
        val client = client(context)
        val allowed = granted(context)
        if (HealthPermission.getWritePermission(ExerciseSessionRecord::class) !in allowed) throw LacticError("Lactic isn't allowed to add workouts to Health Connect")
        val start = Instant.ofEpochMilli((w.start * 1000).toLong())
        val end = Instant.ofEpochMilli((w.end * 1000).toLong())
        // Already there: written by Lactic before, or by Zwift, a bike computer or a watch.
        if (HealthPermission.getReadPermission(ExerciseSessionRecord::class) in allowed) {
            val overlapping = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.between(start.minus(Duration.ofHours(6)), end.plus(Duration.ofHours(6)))))
                .records.filter { it.startTime < end && it.endTime > start }
            if (overlapping.any { it.metadata.clientRecordId == w.id }) return Saved(false, "already saved")
            val span = Duration.between(start, end).seconds.toDouble()
            overlapping.firstOrNull {
                val shared = Duration.between(maxOf(it.startTime, start), minOf(it.endTime, end)).seconds.toDouble()
                shared > span * 0.5 && it.metadata.dataOrigin.packageName != context.packageName
            }?.let { return Saved(false, "already in Health Connect from ${appName(context, it.metadata.dataOrigin.packageName)}") }
        }

        val zone = ZoneId.systemDefault()
        val startOffset: ZoneOffset = zone.rules.getOffset(start)
        val endOffset: ZoneOffset = zone.rules.getOffset(end)
        val device = Device(type = Device.TYPE_PHONE)
        fun meta(part: String) = Metadata.activelyRecorded(device = device, clientRecordId = "${w.id}$part")
        val records = ArrayList<Record>()
        records.add(
            ExerciseSessionRecord(
                startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset,
                metadata = meta(""),
                exerciseType = if (w.indoor) ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY else ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
                title = w.name?.takeIf { it.isNotEmpty() },
            ),
        )
        fun canWrite(type: KClass<out Record>) = HealthPermission.getWritePermission(type) in allowed
        w.kcal?.takeIf { it > 0 && canWrite(ActiveCaloriesBurnedRecord::class) }?.let {
            records.add(ActiveCaloriesBurnedRecord(startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset, energy = Energy.kilocalories(it), metadata = meta(":kcal")))
        }
        w.distanceMeters?.takeIf { it > 0 && canWrite(DistanceRecord::class) }?.let {
            records.add(DistanceRecord(startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset, distance = Length.meters(it), metadata = meta(":distance")))
        }
        fun points(list: List<List<Double>>?): List<Pair<Instant, Double>> =
            list.orEmpty().filter { it.size == 2 && it[1] > 0 }
                .map { start.plusMillis((it[0] * 1000).toLong()) to it[1] }
                .filter { it.first < end }
        val hr = points(w.heartRate)
        if (hr.isNotEmpty() && canWrite(HeartRateRecord::class)) {
            records.add(HeartRateRecord(startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset,
                samples = hr.map { HeartRateRecord.Sample(time = it.first, beatsPerMinute = it.second.toLong().coerceIn(1, 300)) }, metadata = meta(":hr")))
        }
        val power = points(w.power)
        if (power.isNotEmpty() && canWrite(PowerRecord::class)) {
            records.add(PowerRecord(startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset,
                samples = power.map { PowerRecord.Sample(time = it.first, power = Power.watts(it.second.coerceAtMost(100_000.0))) }, metadata = meta(":power")))
        }
        val cadence = points(w.cadence)
        if (cadence.isNotEmpty() && canWrite(CyclingPedalingCadenceRecord::class)) {
            records.add(CyclingPedalingCadenceRecord(startTime = start, startZoneOffset = startOffset, endTime = end, endZoneOffset = endOffset,
                samples = cadence.map { CyclingPedalingCadenceRecord.Sample(time = it.first, revolutionsPerMinute = it.second.coerceAtMost(10_000.0)) }, metadata = meta(":cadence")))
        }
        client.insertRecords(records)
        return Saved(true, null)
    }

    private fun appName(context: Context, pkg: String): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
        pkg
    }
}
