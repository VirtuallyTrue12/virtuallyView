# Casting to a TV

Two open ways, no account, no subscription, nothing sent to a cloud.

## 1. From your browser (Chromecast and AirPlay)

Chrome and Edge find Chromecast and other Google Cast screens themselves; Safari finds AirPlay screens. Open a title, press **Cast** in the player, then **This browser's devices**. virtuallyView gives the TV a signed link that works for that one video for six hours and needs no login on the TV.

The link uses your server's network address, not `localhost`. Set it once under Settings > Server > Connect other devices, or open virtuallyView from its network address.

## 2. DLNA / UPnP (most smart TVs, consoles and boxes)

Press **Cast**, pick a TV under **TVs on your network**. The server finds TVs with SSDP and tells the TV what to play, so you can close the page. The video is sent converted to H.264/AAC, which every TV accepts.

SSDP is a broadcast on the local network. A server running in a container with a private network cannot see it, so on Docker or Podman either run the app on the host network, or use the browser route above. The list says "No TV found" when the server cannot see any.

## What the signed link can do

It plays one playback path for one person and expires. It cannot open other pages, other files or the API. Age limits set for that person still apply.
