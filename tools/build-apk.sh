#!/usr/bin/env bash
#
# Build the YureWatch Android APK.
#
# Deliberately Gradle-free: the app is one Java activity, one bridge class and a
# single HTML asset, so the SDK build tools alone produce a signed APK. That
# makes the build reproducible on a plain Ubuntu runner (see
# .github/workflows/android.yml) without a Gradle wrapper, a plugin cache or a
# network fetch of a build system.
#
# Usage:
#   bash tools/build-apk.sh                 # full build (web assets + APK)
#   bash tools/build-apk.sh --skip-web      # reuse the existing asset
#   KEYSTORE=/path/to.jks bash tools/build-apk.sh
#
# Environment:
#   ANDROID_HOME / ANDROID_SDK_ROOT  Android SDK location
#   JAVA_HOME                        JDK 11+ (17/21 verified)
#   KEYSTORE, KEYSTORE_PASS, KEY_ALIAS, KEY_PASS
#                                    signing identity; a throwaway debug key is
#                                    generated when KEYSTORE is unset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/android/app"
BUILD="$ROOT/build"
ASSETS="$APP/assets"
GEN="$BUILD/gen"
CLASSES="$BUILD/classes"
DEX="$BUILD/dex"
SKIP_WEB=0

for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- toolchain --
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
if [ ! -d "$SDK" ]; then
  echo "error: Android SDK not found at $SDK (set ANDROID_HOME)" >&2
  exit 1
fi

if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  :
elif [ -x /usr/lib/jvm/java-21-openjdk-amd64/bin/javac ]; then
  JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
elif [ -x /usr/lib/jvm/java-17-openjdk-amd64/bin/javac ]; then
  JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
else
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
fi
export JAVA_HOME

# NOTE: build-tools 34.0.0 ships an R8/d8 build that crashes with an internal
# NullPointerException on any class containing an anonymous inner class
# (reproduced with a two-line test class). 35.0.0 and newer are fine, so prefer
# the newest installed build-tools and only fall back to 34.
if [ -n "${BUILD_TOOLS_OVERRIDE:-}" ]; then
  BUILD_TOOLS="$BUILD_TOOLS_OVERRIDE"
elif [ -d "$SDK/build-tools/35.0.0" ]; then
  BUILD_TOOLS="$SDK/build-tools/35.0.0"
else
  BUILD_TOOLS="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
fi
PLATFORM="$SDK/platforms/android-34/android.jar"
if [ ! -f "$PLATFORM" ]; then
  PLATFORM="$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)/android.jar"
fi
for tool in aapt2 d8 zipalign apksigner; do
  if [ ! -x "$BUILD_TOOLS/$tool" ]; then
    echo "error: $tool not found in $BUILD_TOOLS" >&2
    exit 1
  fi
done
echo "== toolchain =="
echo "  JAVA_HOME  $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"
echo "  buildtools $BUILD_TOOLS"
echo "  android.jar $PLATFORM"

VERSION_NAME="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$APP/AndroidManifest.xml")"
VERSION_CODE="$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' "$APP/AndroidManifest.xml")"
echo "  version    $VERSION_NAME ($VERSION_CODE)"

# ------------------------------------------------------------------- assets --
if [ "$SKIP_WEB" -eq 0 ]; then
  echo "== web bundle =="
  ( cd "$ROOT" && npm run build )
fi
if [ ! -f "$ASSETS/index.html" ]; then
  echo "error: $ASSETS/index.html missing; run without --skip-web" >&2
  exit 1
fi
echo "  asset      $(du -h "$ASSETS/index.html" | cut -f1)"

# ------------------------------------------------------------------ compile --
rm -rf "$BUILD"
mkdir -p "$GEN" "$CLASSES" "$DEX" "$BUILD/compiled"

echo "== resources =="
"$BUILD_TOOLS/aapt2" compile --dir "$APP/res" -o "$BUILD/compiled/res.zip"

echo "== link =="
"$BUILD_TOOLS/aapt2" link \
  -o "$BUILD/base-unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$GEN" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  -A "$ASSETS" \
  --no-version-vectors \
  "$BUILD/compiled/res.zip"

echo "== javac =="
mapfile -t SOURCES < <(find "$APP/src" "$GEN" -name '*.java' | sort)
# JDK 9+ rejects -bootclasspath when a --release target is used, and JDK 21 has
# no Java 11 API signatures for Android. Compiling against android.jar as the
# *classpath* with a modern bytecode target is the supported approach; d8
# desugars down to the min-api 24 runtime.
"$JAVA_HOME/bin/javac" \
  -source 8 -target 8 \
  -classpath "$PLATFORM" \
  -d "$CLASSES" \
  -Xlint:-options \
  "${SOURCES[@]}"

echo "== dex =="
mapfile -t CLASS_FILES < <(find "$CLASSES" -name '*.class' | sort)
"$BUILD_TOOLS/d8" \
  --lib "$PLATFORM" \
  --min-api 24 \
  --output "$DEX" \
  "${CLASS_FILES[@]}"

echo "== package =="
cp "$BUILD/base-unsigned.apk" "$BUILD/app-unaligned.apk"
( cd "$DEX" && zip -q -X "$BUILD/app-unaligned.apk" classes.dex )
"$BUILD_TOOLS/zipalign" -p -f 4 "$BUILD/app-unaligned.apk" "$BUILD/app-aligned.apk"

# ----------------------------------------------------------------- signing --
KEYSTORE_PATH="${KEYSTORE:-$ROOT/android/keystore/debug.jks}"
KEY_ALIAS_VALUE="${KEY_ALIAS:-yurewatch}"
KEYSTORE_PASS_VALUE="${KEYSTORE_PASS:-yurewatch-debug}"
KEY_PASS_VALUE="${KEY_PASS:-$KEYSTORE_PASS_VALUE}"
if [ ! -f "$KEYSTORE_PATH" ]; then
  mkdir -p "$(dirname "$KEYSTORE_PATH")"
  echo "== generating throwaway signing key (not for distribution) =="
  "$JAVA_HOME/bin/keytool" -genkeypair -v \
    -keystore "$KEYSTORE_PATH" \
    -alias "$KEY_ALIAS_VALUE" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEYSTORE_PASS_VALUE" -keypass "$KEY_PASS_VALUE" \
    -dname "CN=YureWatch Debug, OU=YureWatch, O=YureWatch, L=Tokyo, C=JP" >/dev/null 2>&1
fi

APK="$BUILD/yurewatch-${VERSION_NAME}.apk"
echo "== sign =="
"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$KEY_ALIAS_VALUE" \
  --ks-pass "pass:$KEYSTORE_PASS_VALUE" \
  --key-pass "pass:$KEY_PASS_VALUE" \
  --min-sdk-version 24 \
  --out "$APK" \
  "$BUILD/app-aligned.apk"

"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | head -5

echo "== verify =="
"$BUILD_TOOLS/aapt2" dump badging "$APK" | grep -E "^(package|application-label|sdkVersion|targetSdkVersion|uses-permission|launchable-activity)" || true
echo
echo "== result =="
ls -lh "$APK" | awk '{print "  " $9 "  " $5}'
echo "  sha256 $(sha256sum "$APK" | cut -d' ' -f1)"
echo
echo "Install with:  adb install -r \"$APK\""
echo "The app launches straight into the map; no server, no localhost."
