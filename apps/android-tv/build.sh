#!/usr/bin/env bash
# Builds the virtuallyView Android TV app. Nothing Android is needed on this computer: Gradle runs in a container.
#
#   apps/android-tv/build.sh
#
# Output: apps/android-tv/dist/virtuallyview-tv.apk, which the server offers at /download/virtuallyview-tv.apk.
# The signing key lives in apps/android-tv/signing/ (made on the first build, never committed). Keep it: an
# update only installs over the app when it is signed with the same key.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Pinned image (Gradle 8.7 wrapper, JDK 17, Android SDK 34). Override with VV_ANDROID_IMAGE to try another.
IMAGE="${VV_ANDROID_IMAGE:-docker.io/mingc/android-build-box:1.25.0}"

cd "$HERE"
mkdir -p signing dist

podman run --rm \
  -v "$HERE":/src \
  -w /src \
  "$IMAGE" \
  sh -c '
    set -e
    if [ ! -f signing/vv-tv.jks ]; then
      keytool -genkeypair -keystore signing/vv-tv.jks -storepass virtuallyview-tv -keypass virtuallyview-tv \
        -alias virtuallyview-tv -keyalg RSA -keysize 2048 -validity 36500 \
        -dname "CN=virtuallyView TV, O=virtuallyView"
    fi
    chmod +x ./gradlew
    ./gradlew --no-daemon assembleRelease
  '

cp app/build/outputs/apk/release/app-release.apk dist/virtuallyview-tv.apk
echo "Built $HERE/dist/virtuallyview-tv.apk ($(du -h dist/virtuallyview-tv.apk | cut -f1))"
