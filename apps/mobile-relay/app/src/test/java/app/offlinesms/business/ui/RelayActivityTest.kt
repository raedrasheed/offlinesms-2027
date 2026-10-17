package app.offlinesms.business.ui

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.LocaleList
import android.view.ContextThemeWrapper
import android.view.LayoutInflater
import android.view.View
import android.widget.ListView
import android.widget.TextView
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.offlinesms.business.R
import app.offlinesms.business.data.db.LogEntity
import app.offlinesms.business.data.db.RelayDb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class RelayActivityTest {
    private fun context(language: String = "en", dark: Boolean = false, scale: Float = 1f): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val config = Configuration(base.resources.configuration).apply {
            setLocales(LocaleList(Locale.forLanguageTag(language)))
            setLayoutDirection(Locale.forLanguageTag(language))
            uiMode = Configuration.UI_MODE_TYPE_NORMAL or if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
            fontScale = scale
        }
        return ContextThemeWrapper(base.createConfigurationContext(config), R.style.Theme_Relay)
    }
    private fun log(event: String, detail: String? = "job=plink_12345678 attempt=1", level: String = "info", id: Long = 1) =
        LogEntity(id, 1792231200000, level, event, detail)

    @Test fun `send sent and delivered mean different things in both languages`() {
        for (language in listOf("en", "ar")) {
            val ctx = context(language)
            val entries = listOf("send", "sent", "delivered").map { RelayActivityText.format(ctx, log(it)) }
            assertEquals(3, entries.map { it.title }.distinct().size)
            assertEquals(ctx.getString(R.string.log_sent_desc), entries[1].explanation.substringBefore('\n'))
            assertEquals(ctx.getString(R.string.log_delivered_desc), entries[2].explanation.substringBefore('\n'))
            assertFalse(entries[2].time.isBlank())
            assertTrue(entries[2].reference!!.contains("12345678"))
            assertFalse(entries[2].reference!!.contains("plink_"))
        }
    }

    @Test fun `old info-level failures and not-sent records still need attention`() {
        val ctx = context()
        assertTrue(RelayActivityText.format(ctx, log("failed")).needsAttention)
        assertTrue(RelayActivityText.format(ctx, log("not-sent", "job=j expired-on-device")).needsAttention)
        assertTrue(RelayActivityText.format(ctx, log("claim", "err: connection", "info")).needsAttention)
        assertFalse(RelayActivityText.format(ctx, log("delivered")).needsAttention)
    }

    @Test fun `ambiguous handoff never promises no SMS was sent or suggests a retry`() {
        val ctx = context()
        for (reason in listOf("ambiguous-handoff", "ambiguous-send-exception", "ambiguous-partial-send")) {
            for (record in listOf(log("not-sent", "job=j $reason"), log("failed", "job=j attempt=2 reason=$reason result=1"))) {
                val entry = RelayActivityText.format(ctx, record)
                assertEquals(ctx.getString(R.string.log_uncertain), entry.title)
                assertTrue(entry.explanation.startsWith(ctx.getString(R.string.log_uncertain_desc)))
                assertTrue(entry.needsAttention)
            }
        }
    }

    @Test fun `report retry and refusal are not SMS send failures`() {
        val ctx = context()
        val retry = RelayActivityText.format(ctx, log("report", "retry later: 2 pending", "warn"))
        val rejected = RelayActivityText.format(ctx, log("report", "dropped job=abc123: denied", "warn"))
        assertEquals(ctx.getString(R.string.log_report_waiting), retry.title)
        assertEquals(ctx.getString(R.string.log_report_rejected), rejected.title)
        assertTrue(retry.needsAttention && rejected.needsAttention)
        assertTrue(rejected.details.contains("abc123"))
        assertFalse(rejected.details.contains("denied"))
    }

    @Test fun `masked recipients stay readable and arbitrary exception text is not displayed`() {
        val ctx = context()
        val masked = RelayActivityText.format(ctx, log("send", "job=j to=•••53"))
        assertTrue(masked.explanation.contains("•••53"))
        val legacy = RelayActivityText.format(ctx, log("send", "job=j to=+970599123453"))
        assertTrue(legacy.explanation.contains("•••53"))
        assertFalse((legacy.details + legacy.explanation).contains("970599123453"))
        val unknown = RelayActivityText.format(ctx, log("future-event", "private message text phone=+970599123453", "warn"))
        assertTrue(unknown.needsAttention)
        assertFalse((unknown.details + unknown.explanation).contains("private message"))
        assertTrue(unknown.details.contains("future-event"))
    }

    @Test fun `processing summaries are not counted as delivered messages`() {
        val ctx = context()
        val entry = RelayActivityText.format(ctx, log("claim", "n=5"))
        assertEquals(ctx.getString(R.string.log_processed), entry.title)
        assertTrue(entry.explanation.contains(ctx.getString(R.string.log_task_count, 5)))
        assertNull(entry.reference)
    }

    @Test fun `filter includes historical failures and recycled rows clear old references`() {
        val ctx = context()
        val adapter = RelayActivityAdapter(ctx)
        val rows = listOf(log("sent", id = 1), log("failed", id = 2), log("heartbeat", null, "warn", 3))
        adapter.submit(rows, true)
        assertEquals(2, adapter.count)
        assertEquals(2L, adapter.getItemId(0))
        val parent = ListView(ctx)
        val view = adapter.getView(0, null, parent)
        assertEquals(View.VISIBLE, view.findViewById<View>(R.id.eventReference).visibility)
        val reused = adapter.getView(1, view, parent)
        assertSame(view, reused)
        assertEquals(View.GONE, reused.findViewById<View>(R.id.eventReference).visibility)
        assertEquals(ctx.getString(R.string.log_heartbeat_error), reused.findViewById<TextView>(R.id.eventTitle).text.toString())
        adapter.submit(rows, false)
        assertEquals(3, adapter.count)
    }

    @Test fun `Room stream updates while open and orders equal timestamps deterministically`() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context(), RelayDb::class.java).allowMainThreadQueries().build()
        val updates = Channel<List<LogEntity>>(Channel.UNLIMITED)
        val observer = launch(Dispatchers.IO) { db.logs().observeRecent().collect { updates.send(it) } }
        try {
            withTimeout(10000) {
                assertTrue(updates.receive().isEmpty())
                db.logs().insert(log("sent", id = 0))
                assertEquals("sent", updates.receive().first().event)
                db.logs().insert(log("delivered", id = 0))
                val rows = updates.receive()
                assertEquals(listOf("delivered", "sent"), rows.map { it.event })
                assertTrue(rows[0].id > rows[1].id)
            }
        } finally { observer.cancel(); observer.join(); db.close() }
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun `actual Android rows render in English Arabic and large-font dark mode`() {
        for ((language, dark, scale) in listOf(Triple("en", false, 1f), Triple("ar", false, 1f), Triple("ar", true, 1.6f))) {
            val ctx = context(language, dark, scale)
            val adapter = RelayActivityAdapter(ctx)
            adapter.submit(listOf(log("delivered"), log("not-sent", "job=plink_12345678 ambiguous-handoff", id = 2)), false)
            val list = ListView(ctx)
            val header = LayoutInflater.from(ctx).inflate(R.layout.dashboard_header, list, false)
            // Inflate the real header as well: missing attrs/styles must fail this test.
            assertNotNull(header.findViewById<View>(R.id.logsAllBtn))
            val row = adapter.getView(0, null, list)
            row.layoutDirection = ctx.resources.configuration.layoutDirection
            val width = (360 * ctx.resources.displayMetrics.density).toInt()
            row.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            row.layout(0, 0, width, row.measuredHeight)
            val detail = row.findViewById<TextView>(R.id.eventDetails)
            assertTrue(detail.height >= (48 * ctx.resources.displayMetrics.density).toInt())
            assertTrue(row.measuredHeight > 100)
            val bitmap = Bitmap.createBitmap(width, row.measuredHeight, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(if (dark) 0xff181818.toInt() else 0xfff6f8fa.toInt())
            row.draw(Canvas(bitmap))
            val out = File("build/reports/relay-activity/$language-${if (dark) "dark-large" else "light"}.png")
            checkNotNull(out.parentFile).mkdirs()
            out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
}
