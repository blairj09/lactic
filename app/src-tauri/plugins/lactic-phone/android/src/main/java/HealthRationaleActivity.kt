// What Health Connect opens from its permission screen ("Read privacy policy"): why Lactic asks.

package fit.lactic.phone

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle

class HealthRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AlertDialog.Builder(this)
            .setTitle("Lactic and Health Connect")
            .setMessage(
                "Lactic reads your sleep, heart rate variability, resting heart rate, breathing rate, heart rate, " +
                    "active energy, steps and VO2 max to work out how recovered you are and to fit your training to it. " +
                    "It adds your rides as cycling workouts.\n\n" +
                    "Your data stays on this phone and the computer you paired it with. Lactic has no servers that " +
                    "receive it. It only leaves your devices if you connect a service yourself, such as an AI coach.",
            )
            .setPositiveButton("OK") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }
}
