// Plain-JVM harness for the relay's Android-free send pipeline (SendPipeline.kt
// + net/RelayModels.kt). It compiles the SAME source files as the app without the
// Android SDK. The full app build + unit tests run separately (assembleDebug /
// testDebugUnitTest). Usage:
//   gradle -p apps/mobile-relay/sendgate-jvm-test test
plugins {
    kotlin("jvm") version "1.9.24"
}

repositories { mavenCentral() }

java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> { kotlinOptions.jvmTarget = "17" }

sourceSets {
    main { kotlin { srcDir("../app/src/main/java"); include("app/offlinesms/business/service/SendPipeline.kt", "app/offlinesms/business/net/RelayModels.kt") } }
    test { kotlin { srcDir("../app/src/test/java"); include("app/offlinesms/business/service/SendPipelineTest.kt") } }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    testImplementation("junit:junit:4.13.2")
}

tasks.test { testLogging { events("passed", "failed"); showStandardStreams = false } }
