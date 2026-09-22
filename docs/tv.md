# Watching on your TV

Four ways, from easiest to most hands-on. None of them needs an account with anyone.

## Before you start

1. The computer running virtuallyView must be switched on.
2. The TV and that computer must be on the same Wi-Fi or home network.
3. Find your server's address. On the computer running virtuallyView, open it, go to **Settings > Server > Connect other devices**, and copy the address shown. It looks like `http://192.168.1.20:3000`. Do not use `localhost`: that only works on the server computer itself.

## Let other devices in (firewall)

Most often, when the app opens on the server computer but not on a phone or TV, the server's firewall is blocking it. Allow the port for your home network, and for Tailscale if you use it:

- **Linux with ufw** (Ubuntu, Mint, CachyOS and others):
  `sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp`
  `sudo ufw allow in on tailscale0 to any port 3000 proto tcp`
  Replace `192.168.0.0/24` with your network: the first three numbers of the server's address, then `.0/24`.
- **Linux with firewalld** (Fedora and others): `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload`
- **Windows:** allow Docker Desktop through Windows Defender Firewall when it asks, or add an inbound rule for TCP port 3000 on private networks.
- **macOS:** allow Docker when macOS asks for incoming connections.

Always use `http://`, not `https://`, with port 3000.

## Option 1: The TV's own web browser

Works on most smart TVs.

1. Open the TV's web browser:
   - **LG (webOS):** the app called **Web Browser**.
   - **Samsung (Tizen):** the app called **Internet**.
   - **Google TV and Android TV:** install a TV browser from the Play Store, such as **TV Bro**.
   - **Fire TV:** install **Amazon Silk** from the app store.
2. Type your server's address, for example `http://192.168.1.20:3000`, and open it.
3. Sign in without typing a password with the remote:
   1. On the TV, choose **Sign in with a code**. The TV shows six digits.
   2. On your phone, open virtuallyView and sign in as usual.
   3. On the phone, open **Account**, find **Sign in another device**, type the six digits and press **Sign it in**.
   4. The TV signs in by itself within a few seconds and stays signed in for 30 days.
4. Bookmark the page in the TV browser so you don't have to type the address again.

If a video will not play in the TV browser, the server converts it for you. If it stutters, press the quality button in the player and pick 720p.

## Option 2: Cast from your phone or laptop

For Chromecast, Google TV, Android TV and Apple TV. Your phone or laptop acts as the remote.

1. Open virtuallyView in the browser on your phone or laptop and start a movie or episode.
2. Press **Cast** in the player's bottom bar.
3. Choose **This browser's devices (Chromecast, AirPlay)**:
   - **Chrome or Edge** list Chromecast and Google TV devices.
   - **Safari on iPhone, iPad or Mac** lists AirPlay devices such as Apple TV.
4. Pick your TV. The video plays on the TV and continues if the phone locks.

Apple TV has no web browser, so AirPlay is the way to use it.

## Option 3: TVs that the server finds by itself (DLNA)

Many smart TVs, game consoles and media boxes accept video sent over the home network (a standard called DLNA).

1. Start a movie or episode on any device and press **Cast**.
2. Under **TVs on your network**, pick your TV. If it is not listed, press **Search again** and make sure the TV is switched on.
3. The TV starts playing. You can close the page on your phone.

If the list always says "No TV found" and you run virtuallyView with Docker, the server cannot see your network from inside its container. Use option 1 or 2, or see [casting](casting.md) for how to let the server see the network.

## Option 4: A laptop and an HDMI cable

Connect a laptop to the TV with an HDMI cable, open virtuallyView in the laptop's browser, and press the fullscreen button in the player. This works with any TV that has an HDMI port.

## Watching away from home

The steps above work inside your home. To reach your server from somewhere else, see [reaching it from outside your home](remote-access.md). Tailscale is the easiest safe way.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| The page does not open on the TV | Check the TV and the server are on the same network, that you used the address from Settings > Server and not `localhost`, and that the server computer's firewall allows port 3000. |
| Typing a password with the remote is painful | Use **Sign in with a code** (option 1, step 3). |
| The video does not play or keeps stopping | Pick a lower quality (720p or 480p) in the player. Converting a 4K file needs a strong server computer. |
| My TV is not in the Cast list | For Chromecast, use Chrome or Edge. For Apple TV, use Safari. For other TVs, see option 3. |
| The TV was signed out | A code sign-in lasts 30 days. Sign in with a new code. |
