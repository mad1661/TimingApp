import ScreenSaver
import WebKit

/// Native macOS screensaver that renders the bundled, self-contained
/// Drag Strip Valley animation (Resources/screensaver.html) in a WKWebView.
/// The HTML is generated from the web app's engine by `npm run build:saver`
/// and requires no network access.
@objc(DragStripValleyView)
public class DragStripValleyView: ScreenSaverView {
    private var webView: WKWebView?

    public override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        setup()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        animationTimeInterval = 1.0 / 30.0
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.37, green: 0.69, blue: 0.83, alpha: 1).cgColor

        let config = WKWebViewConfiguration()
        config.suppressesIncrementalRendering = false

        let web = WKWebView(frame: bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) {
            web.underPageBackgroundColor = NSColor(calibratedRed: 0.37, green: 0.69, blue: 0.83, alpha: 1)
        }
        addSubview(web)
        webView = web

        let bundle = Bundle(for: type(of: self))
        if let url = bundle.url(forResource: "screensaver", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    // The WKWebView animates itself via requestAnimationFrame; nothing to do here.
    public override func animateOneFrame() {}

    public override var hasConfigureSheet: Bool { false }
}
