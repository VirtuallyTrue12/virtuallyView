# virtuallyView on an Android TV (Sony Bravia, Google TV)

The TV app opens the whole virtuallyView library full screen and works with the remote. Films and episodes play in
the TV's own video player, so HEVC, 4K, HDR and surround sound work without the server converting anything.

You install it once. It is a sideloaded app, so Android TV needs to be told to allow it first.

## Install on a Sony Bravia

1. On the TV, open **Settings > Device preferences > Security & restrictions > Unknown sources** and turn it on
   for the app you will use to download the file (the **Downloader** or **BrowseHere** app from the TV's app store,
   or the TV's web browser).
2. Open that app and go to this address, replacing `192.168.1.20` with your server's address (it is shown under
   **Settings > Connect other devices**):

   ```
   http://192.168.1.20:3000/download/virtuallyview-tv.apk
   ```

3. When the download finishes, choose **Install**. Open **virtuallyView** from the TV home row.
4. On first start the app looks for your server on the home network. Choose it, or type its address.
5. Sign in with your own account, the same as on a laptop. Tick **Stay signed in** on a personal TV.

If the page says the TV app has not been built yet, someone needs to build it on the server computer (see below),
then try again.

### Install from a laptop instead

With Wi-Fi debugging turned on for the TV (**Settings > Device preferences > Developer options**):

```
adb connect 192.168.1.50:5555
adb install -r apps/android-tv/dist/virtuallyview-tv.apk
```

## Build it again (on the server computer)

You do not need Java or the Android SDK on your computer. The build runs Gradle inside a container, using the
`docker.io/mingc/android-build-box` image pinned in `apps/android-tv/build.sh`.

```
apps/android-tv/build.sh
```

The first build makes a signing key in `apps/android-tv/signing/` and keeps it there. Keep that folder: an update
installs over the old app only when it is signed with the same key. The finished file is
`apps/android-tv/dist/virtuallyview-tv.apk`. The server offers it at `/download/virtuallyview-tv.apk` from then on,
so rebuild the server image (or restart the server) after building if it runs in a container.

The build output and the signing key are never committed to git.

## Remote control

| Remote button | What it does |
| --- | --- |
| Arrows | Move between cards and buttons |
| OK / Select | Open the focused card or button |
| Back | Close a menu or dialog, otherwise go back a page, otherwise leave the app |
| Play / Pause | Play or pause the video (in the TV player) |

## Troubleshooting

- **No server found.** Make sure the TV and the server are on the same Wi-Fi or network, and that port 3000 is not
  blocked by the server computer's firewall. You can also type the address by hand on the first screen.
- **A film will not play.** The app falls back to the server's converted copy automatically. That needs ffmpeg on
  the server, which the standard install includes.
