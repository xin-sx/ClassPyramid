#!/bin/bash
# Manual Android APK build script - no Gradle required
set -e

# Configuration
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
BUILD_TOOLS=$ANDROID_HOME/build-tools/36.0.0
PLATFORM_JAR=$ANDROID_HOME/platforms/android-36/android.jar
ANDROID_JAR_TARGET=36

PROJECT_DIR=/workspace/ClassPyramid
APP_DIR=$PROJECT_DIR/app
SRC_DIR=$APP_DIR/src/main
BUILD_DIR=$PROJECT_DIR/build_manual
GEN_DIR=$BUILD_DIR/gen
OBJ_DIR=$BUILD_DIR/obj
APK_UNSIGNED=$BUILD_DIR/app-unsigned.apk
APK_ALIGNED=$BUILD_DIR/app-aligned.apk
APK_FINAL=$BUILD_DIR/ClassPyramid-debug.apk

PKG=com.example.classpyramid
PKG_DIR=com/example/classpyramid

rm -rf "$BUILD_DIR"
mkdir -p "$GEN_DIR" "$OBJ_DIR"

# 1) Compile resources with aapt2 (per-resource flat files)
echo "=== Compiling resources ==="
AAPT_COMPILED_DIR=$BUILD_DIR/aapt-compiled
mkdir -p "$AAPT_COMPILED_DIR"
"$BUILD_TOOLS/aapt2" compile --dir "$SRC_DIR/res" -o "$AAPT_COMPILED_DIR"

# 2) Link resources, manifest, assets into base APK
echo "=== Linking resources ==="
ASSETS_DIR=$SRC_DIR/assets
"$BUILD_TOOLS/aapt2" link \
  -I "$PLATFORM_JAR" \
  --manifest "$SRC_DIR/AndroidManifest.xml" \
  --java "$GEN_DIR" \
  -A "$ASSETS_DIR" \
  -o "$APK_UNSIGNED" \
  --target-sdk-version $ANDROID_JAR_TARGET \
  --min-sdk-version 24 \
  --version-code 1 \
  --version-name 1.0 \
  $(find "$AAPT_COMPILED_DIR" -name '*.flat' | sort)

# 3) Compile Java sources
echo "=== Compiling Java sources ==="
JAVA_SRC_DIRS=(
  "$SRC_DIR/java"
  "$GEN_DIR"
)
find "${JAVA_SRC_DIRS[@]}" -name '*.java' > "$BUILD_DIR/sources.txt"
mkdir -p "$OBJ_DIR"
javac \
  -source 1.8 -target 1.8 \
  -bootclasspath "$PLATFORM_JAR" \
  -classpath "$PLATFORM_JAR" \
  -d "$OBJ_DIR" \
  @"$BUILD_DIR/sources.txt"

# 4) Convert .class files to .dex
echo "=== Dexing ==="
CLASS_FILES=$(find "$OBJ_DIR" -name '*.class')
"$BUILD_TOOLS/d8" \
  --min-api 24 \
  --output "$BUILD_DIR" \
  $CLASS_FILES

# 5) Add classes.dex to the APK
echo "=== Adding classes.dex ==="
cd "$BUILD_DIR"
zip -j "$APK_UNSIGNED" classes.dex

# 6) Generate debug keystore if not exists
KEYSTORE=$BUILD_DIR/debug.keystore
if [ ! -f "$KEYSTORE" ]; then
  echo "=== Generating debug keystore ==="
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass android \
    -keypass android \
    -alias androiddebugkey \
    -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000
fi

# 7) Align the APK
echo "=== Aligning APK ==="
"$BUILD_TOOLS/zipalign" -f -p 4 "$APK_UNSIGNED" "$APK_ALIGNED"

# 8) Sign the APK
echo "=== Signing APK ==="
"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "$APK_FINAL" \
  "$APK_ALIGNED"

# 9) Verify
echo "=== Verifying APK ==="
"$BUILD_TOOLS/apksigner" verify "$APK_FINAL"

echo ""
echo "APK built: $APK_FINAL"
ls -la "$APK_FINAL"
