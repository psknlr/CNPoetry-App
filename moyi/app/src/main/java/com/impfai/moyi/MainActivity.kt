package com.impfai.moyi

import android.annotation.SuppressLint
import android.os.Bundle
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
 * 前端为 assets/www 下的静态站点，由进程内环回 HTTP 服务器
 * （AssetHttpServer，127.0.0.1 随机端口）供给。路由状态由前端
 * 自行持久化（localStorage），进程重建后自动续读。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var server: AssetHttpServer

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        server = AssetHttpServer(applicationContext).also { it.start() }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        // 深浅主题交由页面 CSS 的 prefers-color-scheme 处理，禁用算法压暗
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = request.url.host != "127.0.0.1"
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl("http://127.0.0.1:${server.port}/www/index.html")
    }

    override fun onDestroy() {
        server.stop()
        webView.destroy()
        super.onDestroy()
    }
}
