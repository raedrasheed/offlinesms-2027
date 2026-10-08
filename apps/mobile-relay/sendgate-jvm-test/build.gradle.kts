// Plain-JVM harness for the relay's Android-free send rules (SendGate.kt).
// The Android module needs the Android SDK to run its unit tests; this compiles
// the SAME source files on a plain JVM so the rules can be tested anywhere:
//   gradle -p apps/mobile-relay/sendgate-jvm-test test
plugins {
    kotlin("jvm") version "1.9.24"
}

repositories { mavenCentral() }

java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> { kotlinOptions.jvmTarget = "17" }

sourceSets {
    main { kotlin { srcDir("../app/src/main/java"); include("app/offlinesms/business/service/SendGate.kt") } }
    test { kotlin { srcDir("../app/src/test/java"); include("app/offlinesms/business/service/SendGateTest.kt") } }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

tasks.test { testLogging { events("passed", "failed"); showStandardStreams = false } }
