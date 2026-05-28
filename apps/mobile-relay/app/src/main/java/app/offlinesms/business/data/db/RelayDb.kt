package app.offlinesms.business.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [JobEntity::class, ReportEntity::class, LogEntity::class], version = 1, exportSchema = false)
abstract class RelayDb : RoomDatabase() {
    abstract fun jobs(): JobDao
    abstract fun reports(): ReportDao
    abstract fun logs(): LogDao

    companion object {
        @Volatile private var instance: RelayDb? = null
        fun get(context: Context): RelayDb =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, RelayDb::class.java, "relay.db")
                    .fallbackToDestructiveMigration()
                    .build().also { instance = it }
            }
    }
}
