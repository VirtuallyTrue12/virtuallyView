plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.virtuallyview.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.virtuallyview.tv"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "0.4.0"
    }

    // One stable signing key, kept outside git (see build.sh). Reinstalling over an older build needs the same key.
    signingConfigs {
        create("vv") {
            storeFile = file(System.getenv("VV_KEYSTORE") ?: "${rootDir}/signing/vv-tv.jks")
            storePassword = System.getenv("VV_KEYSTORE_PASS") ?: "virtuallyview-tv"
            keyAlias = "virtuallyview-tv"
            keyPassword = System.getenv("VV_KEYSTORE_PASS") ?: "virtuallyview-tv"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("vv")
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
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-common:$media3")
}
