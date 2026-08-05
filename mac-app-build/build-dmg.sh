#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/mac-app-build"
APP_NAME="SpecForge"
APP_BUNDLE="$PROJECT_DIR/$APP_NAME.app"
DMG_BASE="$PROJECT_DIR/SpecForge-1.0.0-macOS"
DMG_FILE="$PROJECT_DIR/SpecForge-1.0.0-macOS.dmg"

echo "🔨 步驟 1：編譯 Web 前端靜態資源（base=./ for file://）..."
cd "$PROJECT_DIR"
if command -v bun >/dev/null 2>&1; then
  bun run build
else
  npm run build
fi

echo "🛠️ 步驟 2：編譯原生 Swift 啟動器與 WebKit 視窗..."
cd "$BUILD_DIR"
swiftc -O -framework Cocoa -framework WebKit main.swift -o "$APP_NAME"

echo "📦 步驟 3：封裝原生 $APP_NAME.app 应用包..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
chmod +x "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp "$BUILD_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp -R "$PROJECT_DIR/dist" "$APP_BUNDLE/Contents/Resources/dist"

echo "✅ 原生 macOS App 已建立於: $APP_BUNDLE"

echo "💿 步驟 4：建立 macOS DMG 磁碟影像檔..."
STAGING_DIR="$(mktemp -d)"
mkdir -p "$STAGING_DIR/$APP_NAME"
cp -R "$APP_BUNDLE" "$STAGING_DIR/$APP_NAME/"
ln -s /Applications "$STAGING_DIR/$APP_NAME/Applications"

rm -f "$DMG_FILE"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING_DIR/$APP_NAME" -ov -format UDZO "$DMG_FILE"

rm -rf "$STAGING_DIR"
echo "🎉 DMG 安裝檔已成功打包至: $DMG_FILE"
