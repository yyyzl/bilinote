configure<com.android.build.gradle.internal.dsl.BaseAppModuleExtension> {
    compileSdk = 36
    defaultConfig { targetSdk = 36 }
    testOptions.unitTests.isIncludeAndroidResources = true
    testOptions.unitTests.all {
        // Robolectric's API 36 FileDescriptor interceptor needs this on JDK 17+.
        it.jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
    }
}
dependencies {
    add("testImplementation", "org.robolectric:robolectric:4.17")
}
