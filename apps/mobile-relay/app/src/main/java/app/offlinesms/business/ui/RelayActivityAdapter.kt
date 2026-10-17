package app.offlinesms.business.ui

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView
import androidx.core.content.ContextCompat
import app.offlinesms.business.R
import app.offlinesms.business.data.db.LogEntity
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** A recycled, bounded activity list; the dashboard header scrolls with it. */
class RelayActivityAdapter(private val context: Context) : BaseAdapter() {
    private var rows: List<Pair<LogEntity, RelayActivityText.Entry>> = emptyList()
    fun submit(logs: List<LogEntity>, problemsOnly: Boolean) {
        rows = logs.map { it to RelayActivityText.format(context, it) }
            .filter { !problemsOnly || it.second.needsAttention }
        notifyDataSetChanged()
    }
    override fun getCount() = rows.size
    override fun getItem(position: Int) = rows[position].first
    override fun getItemId(position: Int) = getItem(position).id
    override fun hasStableIds() = true
    fun indexOf(id: Long) = rows.indexOfFirst { it.first.id == id }

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val view = convertView ?: LayoutInflater.from(context).inflate(R.layout.row_relay_activity, parent, false)
        val entry = rows[position].second
        val color = when (entry.tone) {
            RelayActivityText.Tone.INFO -> R.color.activity_info
            RelayActivityText.Tone.SUCCESS -> R.color.activity_success
            RelayActivityText.Tone.WARNING -> R.color.activity_warning
            RelayActivityText.Tone.ERROR -> R.color.activity_error
        }
        view.findViewById<TextView>(R.id.eventTitle).apply {
            text = entry.title
            setTextColor(ContextCompat.getColor(context, color))
        }
        view.findViewById<TextView>(R.id.eventTime).text = entry.time
        view.findViewById<TextView>(R.id.eventExplanation).text = entry.explanation
        view.findViewById<TextView>(R.id.eventReference).apply {
            text = entry.reference
            visibility = if (entry.reference == null) View.GONE else View.VISIBLE
        }
        view.findViewById<View>(R.id.eventDetails).setOnClickListener {
            val dialog = MaterialAlertDialogBuilder(context).setTitle(entry.title)
                .setMessage(entry.details).setPositiveButton(R.string.log_close, null).show()
            dialog.findViewById<TextView>(android.R.id.message)?.setTextIsSelectable(true)
        }
        return view
    }
}
