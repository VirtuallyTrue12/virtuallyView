// Versions pinned together: Gradle 8.7 runs AGP 8.5.x, which compiles Kotlin 1.9.x. Change them as a set.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
