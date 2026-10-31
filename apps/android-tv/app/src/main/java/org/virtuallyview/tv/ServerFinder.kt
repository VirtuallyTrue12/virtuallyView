package org.virtuallyview.tv

import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Finds virtuallyView servers on the home network, the same way the laptop finds TVs: ask every address. */
object ServerFinder {
    const val PORT = 3000

    /** The home-network /24 prefixes this TV is on, e.g. "192.168.0". */
    fun localPrefixes(): List<String> =
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .mapNotNull { it.hostAddress?.substringBeforeLast('.') }
            .distinct()

    /** True when the address answers the public health check as a virtuallyView server. */
    fun isVirtuallyView(baseUrl: String): Boolean = try {
        val conn = URL("$baseUrl/api/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 500
        conn.readTimeout = 900
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        conn.disconnect()
        body.contains("\"status\":\"ok\"") && body.contains("\"build\"")
    } catch (_: Exception) {
        false
    }

    /**
     * Asks every address on this TV's home network, a batch at a time. [onFound] runs on a
     * background thread for each server; [onDone] runs once the sweep has finished.
     */
    fun sweep(onFound: (String) -> Unit, onDone: () -> Unit) {
        Thread {
            val pool = Executors.newFixedThreadPool(64)
            for (prefix in localPrefixes()) {
                for (host in 1..254) {
                    pool.execute {
                        val base = "http://$prefix.$host:$PORT"
                        if (isVirtuallyView(base)) onFound(base)
                    }
                }
            }
            pool.shutdown()
            pool.awaitTermination(40, TimeUnit.SECONDS)
            onDone()
        }.start()
    }
}
