# Drag Strip Valley — native macOS screensaver

A real macOS screensaver (`.saver` bundle) of the Drag Strip Valley animation:
the Silicon Valley-intro-style drag strip with popping sponsor billboards,
Christmas tree launches, tire smoke and a live clock. It renders the exact same
engine as the web app's `/screensaver` page, bundled into a self-contained
`screensaver.html` (no network needed) and displayed by a tiny Swift
`ScreenSaverView` hosting a WKWebView.

## Install (on your Mac)

Requires Xcode (free, from the App Store). From the repo root:

```bash
cd macos-screensaver
./build.sh
```

That builds `DragStripValley.saver` and copies it to `~/Library/Screen Savers/`.
Then open **System Settings → Screen Saver** and pick **Drag Strip Valley**.

Alternatively, open `DragStripValley.xcodeproj` in Xcode, build (⌘B), and
double-click the produced `DragStripValley.saver` to install it.

> macOS may warn that the screensaver is from an unidentified developer the
> first time (it is ad-hoc signed locally). Right-click → Open, or allow it in
> System Settings → Privacy & Security.

## Layout

| Path | Purpose |
| --- | --- |
| `DragStripValley/DragStripValleyView.swift` | The screensaver plugin: loads the bundled HTML in a WKWebView. |
| `DragStripValley/Resources/screensaver.html` | Generated, self-contained animation (canvas + JS, ~30 kB). |
| `DragStripValley/Info.plist` | Bundle metadata (`NSPrincipalClass = DragStripValleyView`). |
| `build.sh` | One-shot build + install for the current user. |

## Updating the animation

The animation source of truth is `src/lib/screensaver-engine.ts` (shared with
the web `/screensaver` page). After changing it, regenerate the bundled HTML
and rebuild:

```bash
npm run build:saver   # regenerates Resources/screensaver.html (commit it)
cd macos-screensaver && ./build.sh
```
