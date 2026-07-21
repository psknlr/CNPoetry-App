package com.impfai.moyi

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * 环回地址上的极简静态资源服务器：把 assets/ 以真实 HTTP 供给 WebView。
 *
 * 为何不用 WebViewAssetLoader：其依赖 shouldInterceptRequest 拦截，
 * 部分设备（尤其无网络时）WebView 会把导航转为 cache-only 加载，
 * 请求到不了拦截层，直接报 net::ERR_CACHE_MISS。环回 HTTP 是真实
 * TCP 通路，与 WebView 缓存策略解耦，且响应统一 no-store。
 */
class AssetHttpServer(private val context: Context) {

    @Volatile private var serverSocket: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(4)
    var port: Int = 0
        private set

    fun start() {
        if (serverSocket != null) return
        val ss = ServerSocket()
        ss.reuseAddress = true
        ss.bind(InetSocketAddress(InetAddress.getLoopbackAddress(), 0))
        serverSocket = ss
        port = ss.localPort
        thread(name = "moyi-http", isDaemon = true) {
            while (true) {
                val client = try { ss.accept() } catch (_: Exception) { break }
                try { pool.execute { handle(client) } }
                catch (_: Exception) { try { client.close() } catch (_: Exception) {} }
            }
        }
    }

    fun stop() {
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        pool.shutdownNow()
    }

    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                s.soTimeout = 10_000
                val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.ISO_8859_1))
                val requestLine = reader.readLine() ?: return
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                }
                val parts = requestLine.split(" ")
                val out = s.getOutputStream()
                if (parts.size < 2 || (parts[0] != "GET" && parts[0] != "HEAD")) {
                    out.write(header(405, "text/plain", 0)); out.flush(); return
                }
                var path = URLDecoder.decode(parts[1].substringBefore('?'), "UTF-8").trimStart('/')
                if (path.isEmpty()) path = "www/index.html"
                if (path.contains("..")) { out.write(header(404, "text/plain", 0)); out.flush(); return }
                val body = try { context.assets.open(path).use { it.readBytes() } }
                           catch (_: Exception) { null }
                if (body == null) {
                    out.write(header(404, "text/plain", 0)); out.flush(); return
                }
                out.write(header(200, mime(path), body.size))
                if (parts[0] == "GET") out.write(body)
                out.flush()
            } catch (_: Exception) {
                // 客户端断开等瞬态错误：忽略
            }
        }
    }

    private fun header(code: Int, type: String, len: Int): ByteArray {
        val status = when (code) {
            200 -> "200 OK"
            404 -> "404 Not Found"
            else -> "405 Method Not Allowed"
        }
        return ("HTTP/1.1 $status\r\n" +
                "Content-Type: $type\r\n" +
                "Content-Length: $len\r\n" +
                "Cache-Control: no-store\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.ISO_8859_1)
    }

    private fun mime(path: String): String = when (path.substringAfterLast('.', "")) {
        "html" -> "text/html; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "js" -> "application/javascript; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "woff2" -> "font/woff2"
        "png" -> "image/png"
        "svg" -> "image/svg+xml"
        "txt" -> "text/plain; charset=utf-8"
        else -> "application/octet-stream"
    }
}
