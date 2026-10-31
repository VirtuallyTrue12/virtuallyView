package org.virtuallyview.tv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * First screen: finds the server on the home network, or takes an address typed in.
 * The choice is remembered, so the next start goes straight to the library.
 */
class ConnectActivity : Activity() {
    private val ui = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private lateinit var status: TextView
    private lateinit var found: LinearLayout
    private var searching = false
    private val seen = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = prefs.getString(KEY_SERVER, null)
        if (saved != null && !intent.getBooleanExtra(EXTRA_CHANGE, false)) {
            openLibrary(saved)
            return
        }
        setContentView(buildScreen())
        search()
    }

    private fun buildScreen(): ScrollView {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(56), dp(40), dp(56), dp(40))
        }
        column.addView(TextView(this).apply {
            text = "Connect to virtuallyView"
            textSize = 30f
        })
        status = TextView(this).apply {
            textSize = 18f
            setPadding(0, dp(12), 0, dp(16))
        }
        column.addView(status)
        found = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(found)
        column.addView(Button(this).apply {
            text = "Search again"
            setOnClickListener { search() }
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        column.addView(TextView(this).apply {
            text = "Or type the address of your server, for example http://192.168.1.20:3000"
            textSize = 16f
            gravity = Gravity.START
            setPadding(0, dp(28), 0, dp(8))
        })
        val address = EditText(this).apply {
            hint = "http://192.168.1.20:${ServerFinder.PORT}"
            setSingleLine(true)
            id = ADDRESS_ID
        }
        column.addView(address)
        column.addView(Button(this).apply {
            text = "Connect"
            setOnClickListener { connectTyped(address.text.toString()) }
        })
        return ScrollView(this).apply {
            setBackgroundColor(0xFF0E0E12.toInt())
            addView(column)
        }
    }

    private fun search() {
        if (searching) return
        searching = true
        seen.clear()
        found.removeAllViews()
        status.text = "Looking for your virtuallyView server on this network..."
        ServerFinder.sweep(
            onFound = { base -> ui.post { addFound(base) } },
            onDone = {
                ui.post {
                    searching = false
                    if (seen.isEmpty()) status.text = "No server answered on this network. Check that the server is on, and that this TV is on the same Wi-Fi, or type its address below."
                    else status.text = "Choose your server."
                }
            }
        )
    }

    private fun addFound(base: String) {
        if (!seen.add(base)) return
        found.addView(Button(this).apply {
            text = base
            setOnClickListener { openLibrary(base) }
        })
        status.text = "Found a server. Choose it, or keep looking."
    }

    private fun connectTyped(raw: String) {
        var base = raw.trim().trimEnd('/')
        if (base.isEmpty()) {
            status.text = "Type the address first."
            return
        }
        if (!base.startsWith("http://") && !base.startsWith("https://")) base = "http://$base"
        status.text = "Checking $base..."
        Thread {
            val ok = ServerFinder.isVirtuallyView(base)
            ui.post {
                if (ok) openLibrary(base)
                else status.text = "Nothing answered at $base. Check the address and try again."
            }
        }.start()
    }

    private fun openLibrary(base: String) {
        prefs.edit().putString(KEY_SERVER, base).apply()
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_CHANGE = "change"
        const val PREFS = "virtuallyview"
        const val KEY_SERVER = "server"
        private const val ADDRESS_ID = 4201
    }
}
