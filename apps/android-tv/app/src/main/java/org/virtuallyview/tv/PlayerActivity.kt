package org.virtuallyview.tv

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * Plays one title in the TV's own player (ExoPlayer: HEVC, HDR, surround sound) and reports
 * progress back to the server every 10 seconds and when it closes.
 */
class PlayerActivity : Activity() {
    private lateinit var payload: JSONObject
    private var player: ExoPlayer? = null
    private var offsetSeconds = 0.0
    private var usingFallback = false
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            saveProgress(null)
            ui.postDelayed(this, 10_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        payload = JSONObject(intent.getStringExtra(EXTRA_PAYLOAD) ?: "{}")

        val view = PlayerView(this).apply { useController = true }
        setContentView(view)

        // Video needs no login cookie (the link is signed), but the cookie is sent anyway so the server knows who is watching.
        val cookie = payload.optString("cookie")
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(if (cookie.isEmpty()) emptyMap() else mapOf("Cookie" to cookie))
        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
            .build()
        player = exo
        view.player = exo

        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                // The TV could not decode the original file: play the server's converted copy instead, once.
                val fallback = payload.optString("transcodeUrl")
                if (!usingFallback && fallback.isNotEmpty()) {
                    usingFallback = true
                    offsetSeconds = payload.optDouble("transcodeOffset", 0.0)
                    exo.setMediaItem(buildItem(fallback, emptyList()))
                    exo.prepare()
                    exo.playWhenReady = true
                }
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) saveProgress(durationSeconds())
            }
        })

        val start = if (usingFallback) 0L else (payload.optDouble("startSeconds", 0.0) * 1000).toLong()
        exo.setMediaItem(buildItem(payload.getString("url"), subtitles()), start)
        exo.prepare()
        exo.playWhenReady = true
        ui.postDelayed(ticker, 10_000)
    }

    private fun buildItem(url: String, subs: List<MediaItem.SubtitleConfiguration>): MediaItem =
        MediaItem.Builder().setUri(url).setSubtitleConfigurations(subs).build()

    private fun subtitles(): List<MediaItem.SubtitleConfiguration> {
        val list: JSONArray = payload.optJSONArray("subtitles") ?: return emptyList()
        return (0 until list.length()).map { i ->
            val t = list.getJSONObject(i)
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(t.getString("url")))
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLanguage(t.optString("lang").ifEmpty { null })
                .setLabel(t.optString("label").ifEmpty { null })
                .build()
        }
    }

    /** Where playback is now, counting the converted copy's start offset. */
    private fun positionSeconds(): Double = offsetSeconds + (player?.currentPosition ?: 0L) / 1000.0

    private fun durationSeconds(): Double {
        val d = player?.duration ?: C.TIME_UNSET
        return if (d != C.TIME_UNSET && d > 0) d / 1000.0 else payload.optDouble("durationSeconds", 0.0)
    }

    /**
     * Sends the position to /api/progress. Runs in the background; [wait] blocks briefly
     * (used on close, so the title's page shows the new position when it reloads).
     */
    private fun saveProgress(endedAt: Double?): Future<*>? {
        val mediaType = payload.optString("mediaType")
        val mediaId = payload.optString("mediaId")
        if (mediaId.isEmpty() || mediaType.isEmpty()) return null
        val duration = durationSeconds()
        // The end of the file counts as watched. Without a known length there is nothing sensible to save.
        val position = endedAt ?: positionSeconds()
        if (endedAt != null && duration <= 0) return null
        if (endedAt == null && position <= 0) return null
        val body = JSONObject()
            .put("positionSeconds", position)
            .put("durationSeconds", duration)
        if (!payload.isNull("seriesId")) body.put("seriesId", payload.optString("seriesId"))
        val server = payload.optString("serverUrl")
        val cookie = payload.optString("cookie")
        return io.submit {
            try {
                val url = URL("$server/api/progress/$mediaType/${URLEncoder.encode(mediaId, "UTF-8")}")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 3000
                conn.readTimeout = 3000
                conn.setRequestProperty("Content-Type", "application/json")
                if (cookie.isNotEmpty()) conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                conn.responseCode
                conn.disconnect()
            } catch (_: Exception) {
                // No network right now: the next report will carry the position.
            }
        }
    }

    override fun onDestroy() {
        ui.removeCallbacks(ticker)
        // Save the last position before leaving, and wait a moment for it, so the page shows it on return.
        try {
            saveProgress(null)?.get(2, TimeUnit.SECONDS)
        } catch (_: Exception) {
            // Took too long: the server keeps the last report it got.
        }
        MainActivity.pendingReturn = payload.optString("returnPath").ifEmpty { null }
        player?.release()
        player = null
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PAYLOAD = "payload"
    }
}
