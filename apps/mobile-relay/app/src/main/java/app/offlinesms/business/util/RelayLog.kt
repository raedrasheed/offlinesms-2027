package app.offlinesms.business.util

import android.content.Context
import android.util.Log
import app.offlinesms.business.data.db.LogEntity
import app.offlinesms.business.data.db.RelayDb
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val TAG = "OfflineSMSRelay"

/** Operational logging that NEVER records the message body or full phone. */
object RelayLog {
    fun maskPhone(p: String?): String {
        if (p.isNullOrBlank()) return "•"
        val d = p.filter { it.isDigit() }
        return if (d.length <= 2) "••" else "•••" + d.takeLast(2)
    }

    fun info(ctx: Context, event: String, detail: String? = null) = write(ctx, "info", event, detail)
    fun warn(ctx: Context, event: String, detail: String? = null) = write(ctx, "warn", event, detail)
    fun error(ctx: Context, event: String, detail: String? = null) = write(ctx, "error", event, detail)

    private fun write(ctx: Context, level: String, event: String, detail: String?) {
        Log.println(
            when (level) { "error" -> Log.ERROR; "warn" -> Log.WARN; else -> Log.INFO },
            TAG, "$event ${detail ?: ""}",
        )
        val dao = RelayDb.get(ctx).logs()
        CoroutineScope(Dispatchers.IO).launch {
            dao.insert(LogEntity(at = System.currentTimeMillis(), level = level, event = event, detail = detail))
        }
    }
}
