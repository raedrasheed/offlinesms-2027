package app.offlinesms.business.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface JobDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(job: JobEntity): Long

    /** Insert, or replace the row for a newer server attempt (decided by SendPipeline.dedup). */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(job: JobEntity): Long

    @Query("UPDATE jobs SET localStatus = :status, updatedAt = :now WHERE jobId = :jobId")
    suspend fun setStatus(jobId: String, status: String, now: Long)

    @Query("UPDATE jobs SET body = NULL, localStatus = :status, updatedAt = :now WHERE jobId = :jobId")
    suspend fun finalize(jobId: String, status: String, now: Long)

    @Query("SELECT * FROM jobs WHERE jobId = :jobId LIMIT 1")
    suspend fun byId(jobId: String): JobEntity?

    @Query("SELECT COUNT(*) FROM jobs WHERE localStatus IN ('claimed','sending')")
    suspend fun pendingCount(): Int
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

    @Query("SELECT * FROM logs ORDER BY at DESC LIMIT 200")
    suspend fun recent(): List<LogEntity>

    @Query("DELETE FROM logs WHERE at < :before")
    suspend fun purgeOlderThan(before: Long)
}
