// The notification at the end of a workout running on the computer, with Extend and End buttons
// that work from the lock screen without opening the app (the iPhone's RideEnd in Swift). One at
// a time: each schedule replaces the last. Preferences keep which end it's for and when it goes
// off, so the remote seeing the finished workout after it went off doesn't send it twice.

package fit.lactic.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToLong

@JsonIgnoreProperties(ignoreUnknown = true)
class RideEndArgs {
    var key: String = ""
    var inSeconds: Double = 0.0
    var title: String = "Workout done"
    var body: String = ""
    var extendLabel: String = "Extend"
    var extendSeconds: Double = 300.0
    var computer: String = "your computer"
    var workoutName: String = "Workout"
    var duration: Double = 0.0
}

object RideEnd {
    private const val CHANNEL = "lactic.ride-end"
    private const val NOTIFICATION = 4271
    private const val FAILED = 4272
    private const val WORK = "lactic.ride-end"
    private const val PREFS = "lactic.phone"
    private const val KEY_PREF = "rideEnd.key"
    private const val AT_PREF = "rideEnd.at"
    const val EXTEND = "fit.lactic.phone.RIDE_EXTEND"
    const val END = "fit.lactic.phone.RIDE_END"

    private fun channel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "End of a workout", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "When a workout running on your computer reaches its end, with Extend and End buttons"
            })
        }
    }

    fun schedule(ctx: Context, a: RideEndArgs) {
        val now = System.currentTimeMillis() / 1000.0
        val at = now + max(0.0, a.inSeconds)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_PREF, null) == a.key) {
            val was = prefs.getFloat(AT_PREF, 0f).toDouble()
            // Already went off for this end, or still set for (about) the same moment.
            if (was <= now || abs(was - at) < 2) return
        }
        val work = OneTimeWorkRequestBuilder<RideEndWorker>()
            .setInitialDelay(max(0.0, a.inSeconds).roundToLong(), TimeUnit.SECONDS)
            .setInputData(workDataOf("args" to json.writeValueAsString(a)))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, work)
        prefs.edit().putString(KEY_PREF, a.key).putFloat(AT_PREF, at.toFloat()).apply()
    }

    /** No end to tell about (paused, ended, the computer's Ride page closed). */
    fun cancel(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_PREF).remove(AT_PREF).apply()
    }

    fun show(ctx: Context, a: RideEndArgs) {
        channel(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        fun action(what: String, code: Int) = PendingIntent.getBroadcast(
            ctx, code,
            Intent(ctx, RideEndReceiver::class.java).setAction(what).putExtra("args", json.writeValueAsString(a)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
            PendingIntent.getActivity(ctx, 3, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle(a.title)
            .setContentText(a.body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, a.extendLabel, action(EXTEND, 1))
            .addAction(0, "End ride", action(END, 2))
            .build()
        try { nm.notify(NOTIFICATION, n) } catch (e: SecurityException) {}
    }

    /** Runs Extend or End on the computer, as the remote's buttons do, then schedules the next end after an Extend. Android gives a button about 10 seconds, so the request gets 8. */
    suspend fun press(ctx: Context, extend: Boolean, a: RideEndArgs) {
        val pairing = PairingStore.load(ctx) ?: return
        val control = nodes.objectNode().put("name", if (extend) "onExtend" else "onEnd")
        control.putArray("args")
        val body = nodes.objectNode()
        body.set<com.fasterxml.jackson.databind.JsonNode>("control", control)
        body.put("whenFinished", extend)
        val reply = try {
            Link.send(pairing, "ride", body, 8.0).also { PairingStore.save(ctx, pairing) }
        } catch (e: Exception) {
            failed(ctx, if (extend) "Extend" else "End ride", a.computer)
            return
        }
        cancel(ctx)
        if (!extend) return
        val data = reply.path("ride").path("data")
        if (data.isMissingNode) return
        val name = data.path("workout").path("name").asText(a.workoutName)
        val duration = data.path("duration").asDouble(0.0)
        val position = data.path("position").asDouble(0.0)
        val next = RideEndArgs().apply {
            title = a.title; body = a.body; extendLabel = a.extendLabel; extendSeconds = a.extendSeconds
            computer = a.computer; workoutName = name; this.duration = duration
        }
        when {
            data.path("running").asBoolean(false) && duration > position -> {
                next.key = "$name|${duration.roundToLong()}"; next.inSeconds = duration - position
            }
            data.path("finished").asBoolean(false) -> {
                // Not under way yet in the answer: the longer workout ends about Extend's length from now.
                next.key = "$name|${(duration + a.extendSeconds).roundToLong()}"; next.inSeconds = a.extendSeconds
            }
            else -> return
        }
        schedule(ctx, next)
    }

    private fun failed(ctx: Context, what: String, computer: String) {
        channel(ctx)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle("Couldn't reach $computer")
            .setContentText("$what didn't go through. Open Lactic to try again, or use the controls on $computer.")
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(FAILED, n) } catch (e: SecurityException) {}
    }
}

class RideEndWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val a = inputData.getString("args")?.let { json.readValue(it, RideEndArgs::class.java) } ?: return Result.success()
        RideEnd.show(applicationContext, a)
        return Result.success()
    }
}

class RideEndReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.getStringExtra("args")?.let { json.readValue(it, RideEndArgs::class.java) } ?: return
        val extend = intent.action == RideEnd.EXTEND
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                RideEnd.press(context.applicationContext, extend, a)
            } finally {
                done.finish()
            }
        }
    }
}
