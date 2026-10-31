package org.virtuallyview.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * The whole virtuallyView web app, full screen, in a WebView. Video is handed to [PlayerActivity]
 * through the `VVNative` bridge, so it plays in the TV's own player.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var server: String

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = getSharedPreferences(ConnectActivity.PREFS, MODE_PRIVATE).getString(ConnectActivity.KEY_SERVER, null)
        if (saved == null) {
            startActivity(Intent(this, ConnectActivity::class.java))
            finish()
            return
        }
        server = saved
        hideSystemBars()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString virtuallyViewTV/1.0"
        }
        // Keeps the sign-in between launches.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
        }
        web.addJavascriptInterface(TvBridge(), "VVNative")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // The server is off or moved: offer the connect screen again instead of a blank page.
                if (request.isForMainFrame) {
                    startActivity(Intent(this@MainActivity, ConnectActivity::class.java).putExtra(ConnectActivity.EXTRA_CHANGE, true))
                    finish()
                }
            }

            override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: SslError) {
                // Home servers often use a self-signed certificate on the LAN. Refuse anything else.
                handler.cancel()
            }
        }
        web.loadUrl("$server/")
    }

    override fun onResume() {
        super.onResume()
        // Coming back from the player: reload the title's page so the new progress shows.
        pendingReturn?.let {
            pendingReturn = null
            web.loadUrl("$server$it")
        }
    }

    /** Remote Back: close an open menu or dialog first, then go back a page, then leave the app. */
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        web.evaluateJavascript("(function(){return !!(window.vvBack && window.vvBack());})()") { handled ->
            if (handled != "true") {
                if (web.canGoBack()) web.goBack() else finish()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    /** Called from the web page: `VVNative.play(json)` starts the native player. */
    inner class TvBridge {
        @JavascriptInterface
        fun play(json: String) {
            val payload = JSONObject(json)
            // The session cookie goes with the progress reports, so they are saved for the signed-in person.
            payload.put("cookie", CookieManager.getInstance().getCookie(server) ?: "")
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_PAYLOAD, payload.toString()))
            }
        }
    }

    companion object {
        /** Set by the player when it closes: the page to show next. */
        @Volatile
        var pendingReturn: String? = null
    }
}
