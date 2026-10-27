#!/usr/bin/env bash
# Build the Safari (macOS/iOS) version from extension/ with Apple's converter.
# Needs Xcode. First time only: sudo xcodebuild -runFirstLaunch
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/build.mjs
xcrun safari-web-extension-converter extension --project-location safari \
  --app-name "English Reading Assistant" --bundle-identifier com.euhs.english-reading-assistant \
  --swift --no-prompt --force
echo "Open safari/English Reading Assistant/English Reading Assistant.xcodeproj, pick the macOS or iOS scheme, Run."
echo "Then Safari > Settings > Extensions > enable it (macOS: Develop > Allow Unsigned Extensions for local builds)."
