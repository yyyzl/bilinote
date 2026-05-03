#!/bin/bash
# BiNote Android APK 打包脚本
# 用法: ./build-android.sh

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 路径定义
PROJECT_ROOT="G:/AndroidAPP/biliGPT/binote"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
ANDROID_DIR="$TAURI_DIR/gen/android"
BUILD_TOOLS="C:/Users/10455/AppData/Local/Android/Sdk/build-tools/36.0.0"
KEYSTORE="C:/Users/10455/.android/debug.keystore"

# 输出文件
SO_SOURCE="$TAURI_DIR/target/aarch64-linux-android/release/libbinote_lib.so"
SO_DEST="$ANDROID_DIR/app/src/main/jniLibs/arm64-v8a/libbinote_lib.so"
APK_UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk"
APK_ALIGNED="$PROJECT_ROOT/BiNote-arm64-release-aligned.apk"
APK_SIGNED="$PROJECT_ROOT/BiNote-arm64-release-signed.apk"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  BiNote Android APK 打包脚本${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# 步骤1: 编译 Rust 代码
echo -e "${YELLOW}[1/4] 编译 Rust 代码...${NC}"
cd "$PROJECT_ROOT"
npm run tauri android build -- --target aarch64 --apk true || true
# 注意: 这一步会因为符号链接问题报错，但 Rust 编译会成功完成

# 检查 so 文件是否生成
if [ ! -f "$SO_SOURCE" ]; then
    echo -e "${RED}错误: Rust 编译失败，未找到 $SO_SOURCE${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust 编译完成${NC}"
echo ""

# 步骤2: 复制 so 文件
echo -e "${YELLOW}[2/4] 复制 so 文件...${NC}"
mkdir -p "$(dirname "$SO_DEST")"
cp -f "$SO_SOURCE" "$SO_DEST"
echo -e "${GREEN}✓ so 文件复制完成${NC}"
echo ""

# 步骤3: Gradle 构建 APK
echo -e "${YELLOW}[3/4] Gradle 构建 APK...${NC}"
cd "$ANDROID_DIR"
./gradlew assembleArm64Release -x rustBuildArm64Release
if [ ! -f "$APK_UNSIGNED" ]; then
    echo -e "${RED}错误: Gradle 构建失败，未找到未签名 APK${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Gradle 构建完成${NC}"
echo ""

# 步骤4: 对齐并签名 APK
echo -e "${YELLOW}[4/4] 对齐并签名 APK...${NC}"

# 对齐
"$BUILD_TOOLS/zipalign" -f -v -p 4 "$APK_UNSIGNED" "$APK_ALIGNED"

# 签名 (使用 cmd 执行 bat 文件)
cmd //c "$BUILD_TOOLS/apksigner.bat sign --ks $KEYSTORE --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out ${APK_SIGNED//\//\\\\} ${APK_ALIGNED//\//\\\\}"

# 清理临时文件
rm -f "$APK_ALIGNED"

if [ ! -f "$APK_SIGNED" ]; then
    echo -e "${RED}错误: APK 签名失败${NC}"
    exit 1
fi
echo -e "${GREEN}✓ APK 签名完成${NC}"
echo ""

# 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  打包完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "输出文件: ${YELLOW}$APK_SIGNED${NC}"
echo ""

# 显示文件大小
ls -lh "$APK_SIGNED"
