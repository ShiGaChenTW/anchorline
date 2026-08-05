#!/bin/bash
# SpecForge macOS App 打包
#   bash mac-app-build/build-dmg.sh           # 正式版 SpecForge
#   bash mac-app-build/build-dmg.sh --test    # 測試版 SpecForge Test
#   bash mac-app-build/build-dmg.sh --all     # 兩者都打
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/mac-app-build"
VERSION="$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo "1.1.0")"

VARIANT="prod"
if [[ "${1:-}" == "--test" ]]; then
  VARIANT="test"
elif [[ "${1:-}" == "--all" ]]; then
  bash "$0" --prod
  bash "$0" --test
  exit 0
elif [[ "${1:-}" == "--prod" || -z "${1:-}" ]]; then
  VARIANT="prod"
else
  echo "用法: $0 [--prod|--test|--all]"
  exit 1
fi

if [[ "$VARIANT" == "test" ]]; then
  # 測試版：App 顯示名稱含 Test（Dock / 選單列 / Finder）
  APP_DISPLAY_NAME="PRD開發監控台 Test"
  APP_BUNDLE_DIR_NAME="PRD開發監控台 Test"
  APP_EXEC="SpecForgeTest"
  BUNDLE_ID="com.specforge.prd.workbench.test"
  DMG_FILE="$PROJECT_DIR/PRD開發監控台-Test-${VERSION}-macOS.dmg"
else
  # 正式版
  APP_DISPLAY_NAME="PRD開發監控台"
  APP_BUNDLE_DIR_NAME="PRD開發監控台"
  APP_EXEC="SpecForge"
  BUNDLE_ID="com.specforge.prd.workbench"
  DMG_FILE="$PROJECT_DIR/PRD開發監控台-${VERSION}-macOS.dmg"
fi

APP_BUNDLE="$PROJECT_DIR/${APP_BUNDLE_DIR_NAME}.app"
STAGING_NAME="$APP_BUNDLE_DIR_NAME"

echo "════════════════════════════════════════"
echo "  SpecForge macOS · ${VARIANT} · v${VERSION}"
echo "  App: ${APP_DISPLAY_NAME}.app"
echo "════════════════════════════════════════"

echo "🔨 步驟 1：編譯 Web 前端（variant=${VARIANT}，base=./ for file://）..."
cd "$PROJECT_DIR"
export VITE_APP_VARIANT="$VARIANT"
if command -v bun >/dev/null 2>&1; then
  bun run build
else
  npm run build
fi

echo "🛠️ 步驟 2：編譯原生 Swift 啟動器（${APP_EXEC}）..."
cd "$BUILD_DIR"
# 視窗標題由 Info.plist 的 CFBundleDisplayName 在 runtime 讀取
swiftc -O -framework Cocoa -framework WebKit main.swift -o "$APP_EXEC"

echo "📦 步驟 3：封裝 ${APP_DISPLAY_NAME}.app ..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BUILD_DIR/$APP_EXEC" "$APP_BUNDLE/Contents/MacOS/$APP_EXEC"
chmod +x "$APP_BUNDLE/Contents/MacOS/$APP_EXEC"

# 依變體產生 Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>zh_TW</string>
	<key>CFBundleExecutable</key>
	<string>${APP_EXEC}</string>
	<key>CFBundleIdentifier</key>
	<string>${BUNDLE_ID}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${APP_DISPLAY_NAME}</string>
	<key>CFBundleDisplayName</key>
	<string>${APP_DISPLAY_NAME}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${VERSION}</string>
	<key>CFBundleVersion</key>
	<string>${VERSION}</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
</dict>
</plist>
PLIST

cp -R "$PROJECT_DIR/dist" "$APP_BUNDLE/Contents/Resources/dist"

echo "✅ 原生 macOS App： $APP_BUNDLE"

echo "💿 步驟 4：建立 DMG..."
STAGING_DIR="$(mktemp -d)"
mkdir -p "$STAGING_DIR/$STAGING_NAME"
cp -R "$APP_BUNDLE" "$STAGING_DIR/$STAGING_NAME/"
ln -s /Applications "$STAGING_DIR/$STAGING_NAME/Applications"

rm -f "$DMG_FILE"
hdiutil create -volname "$APP_DISPLAY_NAME" -srcfolder "$STAGING_DIR/$STAGING_NAME" -ov -format UDZO "$DMG_FILE"

rm -rf "$STAGING_DIR"
echo "🎉 DMG：$DMG_FILE"
echo "   App：$APP_BUNDLE"
