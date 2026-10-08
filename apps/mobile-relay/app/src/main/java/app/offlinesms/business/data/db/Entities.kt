package app.offlinesms.business.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A claimed relay job, mirrored locally so work survives process death / reboot.
 * The message body lives here only until the job reaches a terminal state, then
 * it is cleared (privacy). Phone numbers are stored only as needed to send and
 * are never written to logs.
 */
@Entity(tableName = "jobs")
data class JobEntity(
    @PrimaryKey val jobId: String,
    val phoneE164: String,
    val body: String?,          // nulled once terminal
    val simSubscriptionId: Int?,
    val traceId: String,
    // local lifecycle: claimed -> sending -> sent -> delivered/failed
    // (also paused/skipped when stopped before any hand-off)
    val localStatus: String,
    val createdAt: Long,
    val updatedAt: Long,
    /** Server attempt this row describes (schema v2). 0 = pre-upgrade row. */
    @ColumnInfo(defaultValue = "0") val attempt: Int = 0,
)

/**
 * A delivery event pending report to the backend. Survives offline; flushed by
 * SyncReportsWorker. No message body is ever stored here.
 */
@Entity(tableName = "reports")
data class ReportEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val jobId: String,
    val status: String,         // sent | delivered | failed
    val reason: String?,
    val androidResultCode: Int?,
    val simSubscriptionId: Int?,
    val createdAt: Long,
)

/** Local operational log — never contains the message body or full phone. */
@Entity(tableName = "logs")
data class LogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val level: String,          // info | warn | error
    val event: String,          // enroll | claim | send | sent | delivered | failed | report | heartbeat
    val detail: String?,
)
