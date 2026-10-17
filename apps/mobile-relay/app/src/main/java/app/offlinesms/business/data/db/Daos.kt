package app.offlinesms.business.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface JobDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(job: JobEntity): Long

    /**
     * A NEWER attempt takes over the logical job's row (Q2). Never writes
     * noResend, and only succeeds while the row is an older attempt AND not
     * marked no-resend — so a mark committed at any moment is never lost and
     * blocks the takeover. Returns the number of rows changed (0 = refused).
     */
    @Query("UPDATE jobs SET attempt = :attempt, phoneE164 = :phone, body = :body, " +
        "simSubscriptionId = :simSubscriptionId, traceId = :traceId, localStatus = :status, updatedAt = :now " +
        "WHERE jobId = :jobId AND attempt < :attempt AND noResend = 0")
    suspend fun takeOver(jobId: String, attempt: Int, phone: String, body: String?, simSubscriptionId: Int?,
                         traceId: String, status: String, now: Long): Int

    /** The local decision point before a hand-off: durable 'sending' for THIS
     *  attempt, only while the logical job is not marked no-resend. 0 = refused. */
    @Query("UPDATE jobs SET localStatus = 'sending', updatedAt = :now " +
        "WHERE jobId = :jobId AND attempt = :attempt AND noResend = 0")
    suspend fun beginSending(jobId: String, attempt: Int, now: Long): Int

    /** Status of ONE attempt: a result for another attempt never touches this row. */
    @Query("UPDATE jobs SET localStatus = :status, updatedAt = :now, " +
        "noResend = CASE WHEN :status IN ('sent','delivered') THEN 1 ELSE noResend END " +
        "WHERE jobId = :jobId AND attempt = :attempt")
    suspend fun setStatus(jobId: String, attempt: Int, status: String, now: Long)

    /** Terminal status of ONE attempt; drops the body (privacy). */
    @Query("UPDATE jobs SET body = NULL, localStatus = :status, updatedAt = :now, " +
        "noResend = CASE WHEN :status IN ('sent','delivered') THEN 1 ELSE noResend END " +
        "WHERE jobId = :jobId AND attempt = :attempt")
    suspend fun finalize(jobId: String, attempt: Int, status: String, now: Long)

    /** Sticky no-resend mark for the LOGICAL job (whatever attempt the row holds). */
    @Query("UPDATE jobs SET noResend = 1, updatedAt = :now WHERE jobId = :jobId")
    suspend fun markNoResend(jobId: String, now: Long)

    @Query("SELECT * FROM jobs WHERE jobId = :jobId LIMIT 1")
    suspend fun byId(jobId: String): JobEntity?

    @Query("SELECT COUNT(*) FROM jobs WHERE localStatus IN ('claimed','sending')")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM jobs WHERE localStatus IN ('claimed','sending')")
    fun observePendingCount(): Flow<Int>
}

@Dao
interface ReportDao {
    @Insert
    suspend fun insert(report: ReportEntity): Long

    @Query("SELECT * FROM reports ORDER BY createdAt ASC LIMIT 100")
    suspend fun batch(): List<ReportEntity>

    @Query("DELETE FROM reports WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("SELECT COUNT(*) FROM reports")
    suspend fun count(): Int
}

@Dao
interface LogDao {
    @Insert
    suspend fun insert(log: LogEntity): Long

    @Query("SELECT * FROM logs ORDER BY at DESC, id DESC LIMIT 200")
    suspend fun recent(): List<LogEntity>

    @Query("SELECT * FROM logs ORDER BY at DESC, id DESC LIMIT 100")
    fun observeRecent(): Flow<List<LogEntity>>

    @Query("DELETE FROM logs WHERE at < :before")
    suspend fun purgeOlderThan(before: Long)
}
