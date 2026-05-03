#!/bin/bash
# BiNote macOS 打包脚本
# 用法: bash build-macos.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  BiNote macOS 打包脚本${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo -e "${RED}错误: macOS .app/.dmg 只能在 macOS 环境打包。${NC}"
  echo -e "${YELLOW}可用方案: 在 Mac 上运行本脚本，或到 GitHub Actions 手动触发 build-macos 工作流。${NC}"
  exit 1
fi

cd "$SCRIPT_DIR"

echo -e "${YELLOW}[1/4] 检查 Rust macOS universal targets...${NC}"
rustup target add aarch64-apple-darwin x86_64-apple-darwin
echo -e "${GREEN}✓ Rust targets 已就绪${NC}"
echo ""

echo -e "${YELLOW}[2/4] 安装前端依赖...${NC}"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
echo -e "${GREEN}✓ 依赖安装完成${NC}"
echo ""

echo -e "${YELLOW}[3/3] 打包 macOS .app 和 .dmg...${NC}"
npm run mac:build
echo -e "${GREEN}✓ macOS 打包完成${NC}"
echo ""

echo -e "${GREEN}输出文件:${NC}"
find "$SCRIPT_DIR/src-tauri/target" \( -name "*.dmg" -o -name "*.app" \) -print
