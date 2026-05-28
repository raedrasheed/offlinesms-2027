package app.offlinesms.business.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted device credentials (Android Keystore-backed). We persist only the
 * non-secret identifiers; the Firebase session (from the custom-token sign-in)
 * is held by FirebaseAuth's own secure storage.
 */
class SecureStore private constructor(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "relay_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var deviceId: String?
        get() = prefs.getString("deviceId", null)
        set(v) = prefs.edit().putString("deviceId", v).apply()

    var businessId: String?
        get() = prefs.getString("businessId", null)
        set(v) = prefs.edit().putString("businessId", v).apply()

    var paused: Boolean
        get() = prefs.getBoolean("paused", false)
        set(v) = prefs.edit().putBoolean("paused", v).apply()

    val isEnrolled: Boolean get() = !deviceId.isNullOrBlank() && !businessId.isNullOrBlank()

    fun clear() = prefs.edit().clear().apply()

    companion object {
        @Volatile private var instance: SecureStore? = null
        fun get(context: Context): SecureStore =
            instance ?: synchronized(this) {
                instance ?: SecureStore(context.applicationContext).also { instance = it }
            }
    }
}
