package app.offlinesms.business.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [JobEntity::class, ReportEntity::class, LogEntity::class], version = 3, exportSchema = false)
abstract class RelayDb : RoomDatabase() {
    abstract fun jobs(): JobDao
    abstract fun reports(): ReportDao
    abstract fun logs(): LogDao

    companion object {
        @Volatile private var instance: RelayDb? = null

        /** v2 adds the server attempt to local job rows. A real migration (not
         *  destructive) so pending delivery reports survive the app update. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0")
            }
        }
        /** v3: sticky per-job no-resend mark; attempt identity on pending reports.
         *  Rows that may already have been handed off are marked no-resend; pending
         *  reports are kept and stay unbound (attempt NULL) — they are never
         *  guessed to belong to the job's current attempt. */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE jobs ADD COLUMN noResend INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE jobs SET noResend = 1 WHERE localStatus IN ('sending','sent','delivered')")
                db.execSQL("ALTER TABLE reports ADD COLUMN attempt INTEGER")
            }
        }
        val MIGRATIONS = arrayOf(MIGRATION_1_2, MIGRATION_2_3)

        fun get(context: Context): RelayDb =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, RelayDb::class.java, "relay.db")
                    .addMigrations(*MIGRATIONS)
                    .build().also { instance = it }
            }
    }
}
