// Android's counterpart to the iPhone's ride Live Activity: one ongoing notification that stays
// current while the phone is locked, for the phone's own ride or the computer's ride seen from the
// phone. The web layer words it (web/lib/ride/live-activity.ts, the same state the iPhone gets);
// this lays it out like the iPhone's lock screen (res/layout/ride_live_*.xml) and keeps it up as a
// foreground service, so Android doesn't put Lactic to sleep mid-ride.
//
// The computer's ride: a locked phone runs no web view, so while nothing comes from the app for a
// few seconds the service asks the computer for its ride itself over the usual sealed link (home
// Wi-Fi, never a relay), as the iPhone's beacon wakes do. Its buttons (Pause, Skip, Extend, End,
// free ERG's -/+) go to the computer the same way. For the phone's own ride the buttons go back to
// the web view as ride controls (src/phone/live-activity.ts).

package fit.lactic.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** `LiveActivityState` in web/lib/ride/live-activity.ts. */
@JsonIgnoreProperties(ignoreUnknown = true)
class LiveState {
    var phase: String = "riding"
    var title: String = "Ride"
    var place: String? = null
    var interval: String? = null
    var step: Int? = null
    var counter: String? = null
    var intervalEnd: Double? = null
    var intervalLeft: Double = 0.0
    var rideEnd: Double? = null
    var rideLeft: Double = 0.0
    var started: Double? = null
    var elapsed: Double = 0.0
    var target: String? = null
    var power: Int? = null
    var heartRate: Int? = null
    var cadence: Int? = null
    var tone: String? = null
    var next: String? = null
    var bar: List<BarPart> = emptyList()
    var at: Double = 0.0
    var note: String? = null
    var erg: Int? = null
    var extend: String? = null
}

@JsonIgnoreProperties(ignoreUnknown = true)
class BarPart {
    var share: Double = 0.0
    var step: Int = 0
}

class RideLiveService : Service() {
    companion object {
        private const val CHANNEL = "lactic.ride-live"
        private const val NOTIFICATION = 4273
        /** The computer's ride: ask it this often (ms) while the app hands over nothing. */
        private const val POLL = 3000L
        /** The app handed over the ride this recently (ms): no need to ask the computer. */
        private const val APP_FRESH = 4500L
        /** Nothing from the computer for this long (ms): live numbers step aside, countdowns keep going. */
        private const val STALE = 25_000L
        /** Free ERG's -/+ buttons. */
        const val ERG_STEP = 10
        const val PRESS = "fit.lactic.phone.RIDE_LIVE_PRESS"

        @Volatile
        var instance: RideLiveService? = null
            private set

        /** What's showing, for the buttons. */
        @Volatile
        var state: LiveState? = null
            private set

        @Volatile
        private var pending: LiveState? = null

        private val main = Handler(Looper.getMainLooper())

        /** Shows or updates the ride (the web layer's state as JSON). */
        fun show(ctx: Context, stateJson: String) {
            val s = json.readValue(stateJson, LiveState::class.java)
            main.post {
                val svc = instance
                if (svc != null) {
                    svc.update(s, fromApp = true)
                } else {
                    pending = s
                    try {
                        ContextCompat.startForegroundService(ctx, Intent(ctx, RideLiveService::class.java))
                    } catch (e: Exception) {
                        // In the background Android may refuse a start: the next update from the open app tries again.
                        pending = null
                    }
                }
            }
        }

        /** The ride's gone: take the notification away, or leave the done workout up for a couple of minutes. */
        fun end(linger: Boolean) {
            main.post {
                pending = null
                instance?.finish(linger)
            }
        }

        fun channel(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Ride in progress", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "The ride under way, with its controls, on the lock screen"
                    setShowBadge(false)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                })
            }
        }

        fun clock(seconds: Double): String {
            val t = max(0, seconds.roundToInt())
            val h = t / 3600
            val m = (t % 3600) / 60
            val s = t % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        }

        /** The app's zone colors, 1 (recovery) to 7 (anaerobic), as on the iPhone (Shared.swift). */
        private val ZONES = intArrayOf(0xFFD5DAE6.toInt(), 0xFFB2C0EA.toInt(), 0xFF8AA2E6.toInt(), 0xFF6283E2.toInt(), 0xFF3F66DB.toInt(), 0xFF2B55D6.toInt(), 0xFF1B3593.toInt())

        fun zone(step: Int?, night: Boolean): Int =
            if (step != null && step in 1..ZONES.size) ZONES[step - 1] else if (night) 0x33FFFFFF else 0x33000000
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poll: Job? = null
    private var lastFromApp = 0L
    private var lastFresh = 0L
    private var started = false
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val s = pending ?: state ?: LiveState()
        pending = null
        channel(this)
        // Android wants the notification up within seconds of the start, whatever else happens.
        try {
            val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
            ServiceCompat.startForeground(this, NOTIFICATION, build(s), type)
            started = true
        } catch (e: Exception) {
            stopSelf()
            return START_NOT_STICKY
        }
        update(s, fromApp = true)
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping Lactic away ends the phone's own ride; the computer's carries on, so keep following it.
        if (state?.place == null) finish(false)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        instance = null
        state = null
        scope.cancel()
        poll = null
        release()
        super.onDestroy()
    }

    /** On the main thread. */
    fun update(next: LiveState, fromApp: Boolean) {
        val now = SystemClock.elapsedRealtime()
        val last = state
        if (last != null) steady(next, last)
        state = next
        if (fromApp) lastFromApp = now
        lastFresh = now
        render()
        if (next.place != null) follow() else unfollow()
    }

    /** Countdown moments drift a second with each update; keep the one showing unless it really moved, so the clock doesn't jump. */
    private fun steady(next: LiveState, last: LiveState) {
        fun keep(a: Double?, b: Double?): Double? = if (a != null && b != null && abs(a - b) <= 2) a else b
        next.intervalEnd = keep(last.intervalEnd, next.intervalEnd)
        next.rideEnd = keep(last.rideEnd, next.rideEnd)
        next.started = keep(last.started, next.started)
    }

    private fun render() {
        val s = state ?: return
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION, build(s))
        } catch (e: SecurityException) {
            // Notifications off for Lactic: the service still keeps the ride going.
        }
    }

    fun finish(linger: Boolean) {
        unfollow()
        val s = state
        if (linger && s != null) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
            try {
                NotificationManagerCompat.from(this).notify(NOTIFICATION, build(s, ongoing = false))
            } catch (e: SecurityException) {}
        } else {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            NotificationManagerCompat.from(this).cancel(NOTIFICATION)
        }
        state = null
        stopSelf()
    }

    // --- The computer's ride while the app is in the background ---------------------------------

    private fun follow() {
        if (poll?.isActive == true) return
        hold()
        poll = scope.launch {
            while (isActive) {
                delay(POLL)
                if (SystemClock.elapsedRealtime() - lastFromApp < APP_FRESH) continue
                ask()
            }
        }
    }

    private fun unfollow() {
        poll?.cancel()
        poll = null
        release()
    }

    private fun ask() {
        val pairing = PairingStore.load(this) ?: return
        val reply = try {
            Link.send(pairing, "ride", nodes.objectNode(), 4.0).also { PairingStore.save(this, pairing) }
        } catch (e: Exception) {
            // Out of reach: the countdowns keep ticking; the numbers go once they're stale.
            main.post { render() }
            return
        }
        main.post { fromComputer(reply, pairing.computer) }
    }

    /** The computer's answer to "ride" (or to a button press): its ride's state, or none any more. */
    fun fromComputer(reply: JsonNode, computer: String) {
        if (instance !== this || state == null) return
        val activity = reply.get("activity")
        if (activity == null || !activity.isObject) {
            // The ride page closed or the ride ended: a done workout lingers a moment.
            finish(linger = reply.path("ride").isObject || state?.phase == "done")
            return
        }
        (activity as ObjectNode).put("place", "On $computer")
        update(json.treeToValue(activity, LiveState::class.java), fromApp = false)
    }

    /** Keeps the CPU and Wi-Fi awake enough to hear the computer with the screen off. */
    private fun hold() {
        if (wake == null) {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lactic:ride-live")
                .apply {
                    setReferenceCounted(false)
                    acquire(6 * 60 * 60 * 1000L)
                }
        }
        if (wifi == null) {
            @Suppress("DEPRECATION")
            val mode = WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifi = applicationContext.getSystemService(WifiManager::class.java)
                ?.createWifiLock(mode, "lactic:ride-live")
                ?.apply {
                    setReferenceCounted(false)
                    acquire()
                }
        }
    }

    private fun release() {
        wake?.let { if (it.isHeld) it.release() }
        wake = null
        wifi?.let { if (it.isHeld) it.release() }
        wifi = null
    }

    // --- The notification ------------------------------------------------------------------------

    private fun build(s: LiveState, ongoing: Boolean = true): android.app.Notification {
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val stale = s.place != null && SystemClock.elapsedRealtime() - lastFresh > STALE
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 10, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(applicationInfo.icon)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(small(s, night, stale))
            .setCustomBigContentView(big(s, night, stale))
            .setContentTitle(s.title)
            .setContentText(s.interval ?: s.note ?: s.target ?: "")
            .setSubText(s.place)
            .setColor(0xFF2B55D6.toInt())
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
        if (!ongoing) {
            b.setTimeoutAfter(120_000).setAutoCancel(true)
            return b.build()
        }
        buttons(s).forEachIndexed { i, (label, name, args) -> b.addAction(0, label, press(i, name, args)) }
        return b.build()
    }

    /** Pause and Skip while riding; End only once paused or done, so a stray tap can't end a ride. */
    private fun buttons(s: LiveState): List<Triple<String, String, String>> = when (s.phase) {
        "ready" -> listOf(Triple("Start", "onPlayPause", "[]"))
        "paused" -> listOf(Triple("Resume", "onPlayPause", "[]"), Triple("End ride", "onEnd", "[]"))
        "done" -> listOf(Triple(s.extend ?: "Extend", "onExtend", "[]"), Triple("End ride", "onEnd", "[]"))
        else -> {
            val erg = s.erg
            if (erg != null) {
                listOf(
                    Triple("−$ERG_STEP W", "onErg", "[${max(0, erg - ERG_STEP)}]"),
                    Triple("Pause", "onPlayPause", "[]"),
                    Triple("+$ERG_STEP W", "onErg", "[${erg + ERG_STEP}]"),
                )
            } else {
                listOfNotNull(Triple("Pause", "onPlayPause", "[]"), if (s.interval != null || s.counter != null) Triple("Skip", "onSkip", "[]") else null)
            }
        }
    }

    private fun press(slot: Int, name: String, args: String): PendingIntent {
        val code = 11 + slot
        val intent = Intent(this, RideLiveReceiver::class.java)
            .setAction(PRESS)
            .putExtra("name", name)
            .putExtra("args", args)
        return PendingIntent.getBroadcast(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun color(id: Int) = ContextCompat.getColor(this, id)

    private fun toneColor(s: LiveState): Int? = when (s.tone) {
        "on" -> color(R.color.lactic_ride_on)
        "under" -> color(R.color.lactic_ride_under)
        "over" -> color(R.color.lactic_ride_over)
        else -> null
    }

    /** Elapsed-realtime base for a Chronometer that reaches 0 (or started) at `epochSeconds`. */
    private fun base(epochSeconds: Double): Long =
        SystemClock.elapsedRealtime() + (epochSeconds * 1000 - System.currentTimeMillis()).toLong()

    private fun corner(s: LiveState): String = when (s.phase) {
        "ready" -> "Ready"
        "paused" -> "Paused"
        "done" -> "Done"
        else -> s.place ?: ""
    }

    private fun small(s: LiveState, night: Boolean, stale: Boolean): RemoteViews {
        val v = RemoteViews(packageName, R.layout.ride_live_small)
        v.setInt(R.id.dot, "setColorFilter", zone(s.step, night))
        v.setViewVisibility(R.id.dot, if (s.step != null) View.VISIBLE else View.GONE)
        val name = when (s.phase) {
            "ready" -> "Pedal to start"
            "done" -> "Workout done"
            else -> s.interval ?: s.title
        }
        v.setTextViewText(R.id.name, name)
        clockInto(v, R.id.clock, R.id.clock_text, s, night)
        val power = if (stale) null else s.power
        v.setTextViewText(R.id.power, power?.let { "$it W" } ?: (if (s.phase == "paused") "Paused" else s.target ?: ""))
        val tone = if (power != null) toneColor(s) else null
        if (tone != null) v.setTextColor(R.id.power, tone)
        return v
    }

    private fun big(s: LiveState, night: Boolean, stale: Boolean): RemoteViews {
        val v = RemoteViews(packageName, R.layout.ride_live_big)
        v.setTextViewText(R.id.title, s.title)
        v.setTextViewText(R.id.corner, corner(s))
        if (s.phase == "paused") v.setTextColor(R.id.corner, color(R.color.lactic_ride_under))
        val message = s.phase == "ready" || s.phase == "done"
        v.setViewVisibility(R.id.live, if (message) View.GONE else View.VISIBLE)
        v.setViewVisibility(R.id.message, if (message) View.VISIBLE else View.GONE)
        if (message) {
            v.setTextViewText(R.id.headline, if (s.phase == "ready") "Pedal to start" else "Workout done${s.note?.let { " · $it" } ?: ""}")
            val sub = if (s.phase == "ready") s.note else null
            v.setTextViewText(R.id.subline, sub ?: "")
            v.setViewVisibility(R.id.subline, if (sub != null) View.VISIBLE else View.GONE)
        } else {
            val free = s.erg != null
            v.setViewVisibility(R.id.dot, if (s.step != null) View.VISIBLE else View.GONE)
            v.setInt(R.id.dot, "setColorFilter", zone(s.step, night))
            v.setTextViewText(R.id.interval, if (free) "Target" else s.interval ?: "")
            if (free) {
                v.setViewVisibility(R.id.clock, View.GONE)
                v.setViewVisibility(R.id.clock_text, View.VISIBLE)
                v.setTextViewText(R.id.clock_text, "${s.erg} W")
                v.setTextViewText(R.id.cap, "free ride")
            } else {
                clockInto(v, R.id.clock, R.id.clock_text, s, night)
                v.setTextViewText(R.id.cap, listOfNotNull("left", s.counter?.replaceFirstChar { it.lowercase() }).joinToString(" · "))
            }
            val power = if (stale || s.phase != "riding") null else s.power
            v.setTextViewText(R.id.power, power?.toString() ?: "–")
            toneColor(s)?.takeIf { power != null }?.let { v.setTextColor(R.id.power, it) }
            v.setViewVisibility(R.id.power_row, if (power != null) View.VISIBLE else View.GONE)
            v.setTextViewText(R.id.target, if (free) "" else s.target?.let { "target $it" } ?: "")
            val hr = if (stale) null else s.heartRate
            val cad = if (stale) null else s.cadence
            v.setTextViewText(R.id.body, listOfNotNull(hr?.let { "♥ $it" }, cad?.let { "$it rpm" }).joinToString("   "))
        }
        // The workout bar (none for free ride) and what's next.
        if (s.bar.isEmpty()) {
            v.setViewVisibility(R.id.bar, View.GONE)
        } else {
            v.setViewVisibility(R.id.bar, View.VISIBLE)
            v.setImageViewBitmap(R.id.bar, barBitmap(s, night))
        }
        val showFoot = !message && (s.next != null || s.rideEnd != null || s.rideLeft > 0)
        v.setViewVisibility(R.id.foot, if (showFoot) View.VISIBLE else View.GONE)
        v.setTextViewText(R.id.next, s.next?.let { "Next: $it" } ?: "")
        val rideEnd = s.rideEnd
        if (s.phase == "riding" && rideEnd != null) {
            v.setChronometer(R.id.ride_left, base(rideEnd), "%s left", true)
            v.setChronometerCountDown(R.id.ride_left, true)
            v.setViewVisibility(R.id.ride_left, View.VISIBLE)
            v.setViewVisibility(R.id.ride_left_text, View.GONE)
        } else {
            v.setViewVisibility(R.id.ride_left, View.GONE)
            v.setViewVisibility(R.id.ride_left_text, if (s.rideLeft > 0) View.VISIBLE else View.GONE)
            v.setTextViewText(R.id.ride_left_text, "${clock(s.rideLeft)} left")
        }
        return v
    }

    /** The interval countdown: ticking while riding (Android keeps it going between updates), still while paused. */
    private fun clockInto(v: RemoteViews, clock: Int, text: Int, s: LiveState, night: Boolean) {
        val end = s.intervalEnd
        val started = s.started
        when {
            s.phase == "riding" && end != null -> {
                v.setChronometer(clock, base(end), null, true)
                v.setChronometerCountDown(clock, true)
                v.setViewVisibility(clock, View.VISIBLE)
                v.setViewVisibility(text, View.GONE)
            }
            s.phase == "riding" && started != null -> {
                v.setChronometer(clock, base(started), null, true)
                v.setChronometerCountDown(clock, false)
                v.setViewVisibility(clock, View.VISIBLE)
                v.setViewVisibility(text, View.GONE)
            }
            else -> {
                v.setViewVisibility(clock, View.GONE)
                v.setViewVisibility(text, View.VISIBLE)
                v.setTextViewText(text, if (s.phase == "paused" && s.interval == null) clock(s.elapsed) else if (s.phase == "paused") clock(s.intervalLeft) else "")
                if (s.phase == "paused") v.setTextColor(text, if (night) 0x99FFFFFF.toInt() else 0x99000000.toInt())
            }
        }
    }

    /** The workout as colored blocks with a mark where the ride is: drawn, because notifications can't size views by share. */
    private fun barBitmap(s: LiveState, night: Boolean): Bitmap {
        val w = 1000
        val h = 24
        val gap = 4f
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        var x = 0f
        for (part in s.bar) {
            val width = (part.share * w).toFloat()
            p.color = zone(part.step.takeIf { it > 0 }, night)
            c.drawRoundRect(x, 4f, max(x + 1f, x + width - gap), h - 4f, 5f, 5f, p)
            x += width
        }
        val at = (s.at.coerceIn(0.0, 1.0) * w).toFloat()
        p.color = if (night) 0xFFFFFFFF.toInt() else 0xFF1B1B1F.toInt()
        c.drawRect(max(0f, at - 3f), 0f, minOf(w.toFloat(), at + 3f), h.toFloat(), p)
        return bmp
    }
}

/** A button on the ride notification. */
class RideLiveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RideLiveService.PRESS) return
        val name = intent.getStringExtra("name") ?: return
        val args = intent.getStringExtra("args") ?: "[]"
        val s = RideLiveService.state ?: return
        if (s.place == null) {
            // The phone's own ride: the web view runs it.
            LacticPhonePlugin.current?.rideControl(name, args)
            return
        }
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                press(context.applicationContext, name, args)
            } finally {
                done.finish()
            }
        }
    }

    /** Sends the press to the computer, as the remote's buttons do, and shows its answer straight away. Android gives a button about 10 seconds. */
    private fun press(ctx: Context, name: String, args: String) {
        val pairing = PairingStore.load(ctx) ?: return
        val control = nodes.objectNode().put("name", name)
        control.set<JsonNode>("args", json.readTree(args))
        val request = nodes.objectNode()
        request.set<JsonNode>("control", control)
        if (name == "onExtend") request.put("whenFinished", true)
        val reply = try {
            Link.send(pairing, "ride", request, 8.0).also { PairingStore.save(ctx, pairing) }
        } catch (e: Exception) {
            val what = when (name) { "onPlayPause" -> "Pause"; "onSkip" -> "Skip"; "onExtend" -> "Extend"; "onEnd" -> "End ride"; else -> "That change" }
            RideEnd.failed(ctx, what, pairing.computer)
            return
        }
        // Ended: no end-of-workout alert to wait for any more.
        if (name == "onEnd") RideEnd.cancel(ctx)
        Handler(Looper.getMainLooper()).post { RideLiveService.instance?.fromComputer(reply, pairing.computer) }
    }
}
