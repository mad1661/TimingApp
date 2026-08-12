#!/usr/bin/env bash
# Builds DragStripValley.saver and installs it for the current user.
# Requires Xcode (or Command Line Tools + Xcode) on macOS.
set -euo pipefail
cd "$(dirname "$0")"

xcodebuild -project DragStripValley.xcodeproj \
  -target DragStripValley \
  -configuration Release \
  SYMROOT="$PWD/build" \
  build

SAVER="build/Release/DragStripValley.saver"
DEST="$HOME/Library/Screen Savers"

mkdir -p "$DEST"
rm -rf "$DEST/DragStripValley.saver"
cp -R "$SAVER" "$DEST/"

echo
echo "Installed: $DEST/DragStripValley.saver"
echo "Open System Settings → Screen Saver and select 'Drag Strip Valley'."
echo "(If it was already selected, toggle to another saver and back to reload.)"
