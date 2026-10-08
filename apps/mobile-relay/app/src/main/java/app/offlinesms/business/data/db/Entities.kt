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
    /**
     * Sticky (schema v3): this logical job may already have reached the network
     * on this device, so NO later attempt of it may be handed off here. Set
     * before any report about it is queued; never cleared by a report, a
     * finalize, a restart or a newer attempt.
     */
    @ColumnInfo(defaultValue = "0") val noResend: Boolean = false,
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
    /** Server attempt the report describes (schema v3). null = pre-upgrade row
     *  or a callback without attempt identity: sent unbound, and the server
     *  applies it only to a job that was never re-leased. */
    val attempt: Int? = null,
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
