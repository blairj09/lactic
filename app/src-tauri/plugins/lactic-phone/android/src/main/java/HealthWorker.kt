// The background read. Health Connect can't wake an app the way HealthKit does, so WorkManager
// runs this about every 15 minutes (Android's shortest period, and it bunches runs to save
// battery). Each run asks Health Connect whether sleep, HRV or resting heart rate changed; only
// then it reads the last three days, sends them to the computer and queues them for the app.
// Needs Health Connect's "read in the background" permission, which the rider allows with the rest.

package fit.lactic.phone

import android.content.Context
import androidx.health.connect.client.permission.HealthPermission
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class HealthWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        try {
            if (!Health.available(ctx)) return Result.success()
            if (HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in Health.granted(ctx)) return Result.success()
            if (!Health.changed(ctx)) return Result.success()
            woke(ctx)
        } catch (e: Exception) {
            // Next run tries again.
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "lactic.health"

        /** New Health data: read the last three days, send them to the computer, keep them for the app. */
        suspend fun woke(ctx: Context) {
            val body = Health.read(ctx, 3)
            val id = Queue.add(ctx, body)
            PairingStore.load(ctx)?.let { pairing ->
                try {
                    Link.send(pairing, "health", body, 20.0)
                    PairingStore.save(ctx, pairing)
                } catch (e: Exception) {
                    // The computer gets it on the next sync instead.
                }
            }
            LacticPhonePlugin.current?.healthArrived(id)
        }

        fun schedule(ctx: Context) {
            val work = PeriodicWorkRequestBuilder<HealthWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, work)
        }
    }
}
