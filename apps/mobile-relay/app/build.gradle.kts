// App module (Phase 0 scaffold). Dependencies (Firebase Auth/Firestore/Messaging,
// Room, WorkManager, security-crypto) are added in Phase 2.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.offlinesms.business"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.offlinesms.business" // distinct from the consumer app
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Phase 2: firebase-bom, firebase-auth, firestore, messaging, room, workmanager,
    // androidx.security:security-crypto, lifecycle. None needed for the scaffold.
}
