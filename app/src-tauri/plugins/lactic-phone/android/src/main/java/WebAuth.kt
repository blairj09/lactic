// Signing in to another service from the phone (Strava, for posting rides): its page opens in the
// rider's browser, which has their Strava cookies, and comes back to lactic://... when they tap
// Authorize. WebAuthActivity catches that address and hands it here; the web layer reads the code
// from it. Coming back to Lactic without it (Back, or switching apps) ends the sign-in.

package fit.lactic.phone

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import app.tauri.plugin.Invoke

object WebAuth {
    private var pending: Invoke? = null
    private var watching = false

    fun start(activity: Activity, invoke: Invoke, url: String) {
        pending?.reject("Another sign-in started.")
        pending = invoke
        watch(activity)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: Exception) {
            pending = null
            invoke.reject("No browser on this phone could open the sign-in page.")
        }
    }

    /** The address the page came back to. */
    fun finish(back: Uri) {
        pending?.resolveObject(mapOf("url" to back.toString()))
        pending = null
    }

    /** Lactic in front again with no answer: the rider left the sign-in. */
    private fun watch(activity: Activity) {
        if (watching) return
        watching = true
        activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(a: Activity) {
                if (a === activity && pending != null) {
                    pending?.reject("Sign-in was closed before it finished.")
                    pending = null
                }
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }
}

/** Opened by the browser at lactic://...; passes the address on and brings Lactic back. */
class WebAuthActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.let { WebAuth.finish(it) }
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED))
        }
        finish()
    }
}
