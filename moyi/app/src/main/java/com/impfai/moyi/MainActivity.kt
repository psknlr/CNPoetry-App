package com.impfai.moyi

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

/**
 * 墨一 —— 离线诗词档案馆。
 *
 * 加载策略（为「任何设备都能打开」而设计的双路径）：
 *
 * 1. 主路径 file:///android_asset —— WebView 内部通道，完全不经过
 *    网络栈：没有缓存（不会 ERR_CACHE_MISS）、没有套接字（不会
 *    ERR_CONNECTION_REFUSED）、也不受系统/VPN 代理影响（挂代理的
 *    设备上 http://127.0.0.1 会被交给代理转发而连接失败）。
 *    android_asset 的可达性不依赖 allowFileAccess 开关。
 *
 * 2. 兜底路径 —— 若极个别 WebView 对 file 页面禁用了 XHR 或主帧
 *    加载失败，自动切换到进程内环回 HTTP 服务器（AssetHttpServer）。
 *    切换由 onReceivedError（主帧）与前端 JS 桥（数据请求连续失败）
 *    双通道触发，只切一次。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var server: AssetHttpServer? = null
    private var fellBack = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            textZoom = 100
            // 主路径必需：允许 file 页面经 XHR 读取同为 file 的数据分片。
            // 该开关自 API 30 起标记为过时但行为保留；范围仅限本应用可读
            // 文件，且本应用不加载任何外部内容（见 network_security_config）。
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
        }
        // 深浅主题交由页面 CSS 的 prefers-color-scheme 处理，禁用算法压暗
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun assetsUnreachable() = runOnUiThread { fallbackToServer() }
        }, "MoYiBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val u = request.url
                return !(u.scheme == "file" || u.host == "127.0.0.1")
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) runOnUiThread { fallbackToServer() }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl("file:///android_asset/www/index.html")
    }

    private fun fallbackToServer() {
        if (fellBack || isFinishing) return
        fellBack = true
        val srv = AssetHttpServer(applicationContext).also { it.start() }
        server = srv
        webView.loadUrl("http://127.0.0.1:${srv.port}/www/index.html")
    }

    override fun onDestroy() {
        server?.stop()
        webView.destroy()
        super.onDestroy()
    }
}
