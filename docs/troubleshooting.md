# Troubleshooting

Find what you see, then follow the fix. Every item here is a problem someone actually ran into.

**Three checks that solve most problems:**

1. Run `docker compose ps` on the server computer. Every service should say `Up`. If not, run `docker compose up -d`.
2. Open **Home**. The **Finish setting up** list says what is missing, with a button for each.
3. Open **Diagnostics** (under **More**). It checks every service and explains, in plain words, why one does not answer.

---

## Installing and starting

### The page will not open right after `docker compose up -d`

The first start downloads the services it needs, about 2 GB, and nothing opens until that is done. On a slow connection this can take 10 to 20 minutes. Watch progress with `docker compose ps` or `docker compose logs -f`. Later starts take seconds.

### "Port 3000 is already in use"

Something else on the computer uses port 3000. Stop it, or change `"0.0.0.0:3000:3000"` in `docker-compose.yml` to another port, for example `"0.0.0.0:3010:3000"`, and open `http://localhost:3010`.

### The page opened before, and does not after a restart of the computer (Podman)

With rootless Podman, a container that starts at boot can come up before the network is ready, and its port never opens. Run `docker compose up -d` once. Nothing is lost.

### A service stays unhealthy, and recreating it fails with "conmon exited prematurely" (Podman)

Remove it and start it again: `podman rm -f <name>`, then `docker compose up -d <service>`. Its settings live in a volume, so they survive.

### Posters, trailers and search suggestions never load, but the library does

The container cannot look up internet addresses (DNS). Every service in `docker-compose.yml` has `dns: [1.1.1.1, 8.8.8.8]`: keep that line if you edit the file. If you use the outbound proxy (Settings > Server), check it with the test button there.

### Two copies of a service, or "HTTP 401" from a service that used to work

A leftover container from an older setup is holding the port and answering with a different key. `docker ps -a` should list each service once. Remove the old one.

---

## Opening it on other devices

### It works on the server computer but not on my phone, TV or laptop

In order, check:

1. **Use `http://`, not `https://`.** Port 3000 speaks plain `http`.
2. **Use the network address, not `localhost`.** Settings > Server > Connect other devices shows it, for example `http://192.168.0.20:3000`.
3. **Same Wi-Fi.** Not mobile data, and not a guest network: guest networks usually stop devices from seeing each other.
4. **The server's firewall.** This is the most common cause. See [let other devices in](tv.md#let-other-devices-in-firewall). On Linux with ufw:
   `sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp`
   Replace `192.168.0.0/24` with your own network. Check it was saved with `sudo ufw status`.

### My public address (`http://<my-ip>:3000`) does not open from outside

Your router does not pass the connection on. See [reaching it from outside your home](remote-access.md). In short:

- Most home connections change their public address from time to time, so a link to it stops working anyway.
- Some providers share one address among many customers (carrier-grade NAT). Then no router setting can make it work.
- Testing your own public address from your own Wi-Fi usually fails even when everything is right. Test from a phone on mobile data.
- **The easy, safe way is Tailscale:** free, no router changes, and the address never changes.

### It is slow or laggy on another device

- Reload once with a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) so the browser keeps the compressed, cached app.
- Use 5 GHz Wi-Fi if you can. 2.4 GHz is much slower and more crowded.
- Video that needs converting (MKV, HEVC, 4K) depends on the server computer's processor. Pick a lower quality in the player, such as 720p.

### Signing in on a TV with the remote is painful

On the TV choose **Sign in with a code**, then type the six digits on your phone under **Account > Sign in another device**. See [watching on your TV](tv.md).

### "Too many sign-in attempts. Wait a minute and try again."

Sign-in is limited to protect accounts from password guessing. Wait one minute.

---

## Setting up

### "Finish setting up" shows something missing

Press **Set up for me**. It runs the same setup as the first start again and skips what is already done, so it is safe to press more than once. If a service is "not running yet", start it on the server computer with `docker compose up -d`, then press the button again.

### Requests find nothing ("Places to search")

The app needs at least one place to search. **Set up for me** adds Internet Archive, which is legal but has mostly older, public-domain films. For more, open **Settings > Indexers** and add sources you are allowed to use.

### I use my own Radarr, Sonarr or Lidarr, not the bundled ones

Run only the app with `docker compose up -d app`, then connect each service under **Settings > Services** with its address and API key (in that service's Settings > General). Use an address the app can reach, not `localhost`.

---

## Requests and downloads

### A download finished, but the movie, episodes or album never show up

Open **Downloads**. A finished download that could not be added to the library says why, in plain words, and has a **Retry** button. The usual reasons:

- **"A file with the same name is already in the library folder"**: file renaming was off in an older install. It is on for new installs; on an old one, run **Set up for me** once, then **Retry**.
- **"The download does not match the wanted release closely enough"**: it is a different edition of the album or film. **Retry** rejects it and searches for another.

### The wrong film was downloaded (right name, wrong video)

Open the film. A warning appears when the file's length does not match the film, or when it is labelled as a home release before one exists. Press **Replace this file**: that copy is rejected for good and a new search starts.

### Only camera recordings exist for a new film

Requesting a film that is still in cinemas asks whether to **wait for a proper release** (it downloads automatically later) or search now. Waiting is almost always better.

### Something is missing: a movie, an episode or an album

Use **Search again** on the film, on the season or episode, on the album, or on the artist. It asks the service to look again right away.

### Music comes in mono or low quality

New artists use the **Lossless** quality, and mono and low-bitrate copies are refused. For an artist added earlier, open it and choose Lossless under its quality. Each track shows its real format, and mono tracks are marked in red.

### The download progress on a poster does not move

It refreshes every few seconds while something downloads. If it is stuck, open **Downloads**: the download itself may be stalled, or waiting for a source to share it.

---

## Watching

### A video will not play, or stutters

The player converts files the browser cannot play. If it says conversion is unavailable, ffmpeg is missing (the Docker image includes it; a source install needs ffmpeg and ffprobe). For stutter, choose a lower quality in the player. Converting 4K needs a strong server computer.

### No subtitles

Press **Get subtitles** under the player: search in your language, or upload a subtitle file you have. If it says subtitles are not connected, run **Set up for me**. On an install from before subtitles were set up automatically, Bazarr may use a different key: copy its key from Bazarr's Settings > General into `BAZARR_API_KEY` in a `.env` file next to `docker-compose.yml`, then run `docker compose up -d`.

### Casting: my TV is not in the list

- Chromecast and Google TV appear in **Chrome or Edge** only. Apple TV appears in **Safari** only.
- **TVs on your network** (DLNA) cannot be seen from inside Docker's private network. Use the browser route above, or see [casting](casting.md).

### Live TV: a channel stays black or says it is not answering

Free public channels go offline often. Channels marked **Geo-blocked** only play in their own country, and **Not 24/7** ones only at certain hours. Try another channel.

### Live TV: "That channel is no longer in your playlists"

The playlist was removed or changed since the page was opened. Reload the page.

### Music artwork is missing

Covers come through the server. If they stay blank, check that the music service is running (`docker compose ps`), then reload.

---

## Accounts and the assistant

### I forgot my password

An administrator can reset it under **Settings > Users**. If you are the only administrator, reset it on the server computer:

```bash
docker compose exec app npm run admin -- reset-password <username>
```

It prints a new password and signs that account out everywhere. `npm run admin -- users` lists the accounts.

### The assistant says "That question needs the AI model"

Everyday questions work without it. For the rest, add the assistant (about 5 GB): `docker compose --profile ai up -d`.

---

## Updating

```bash
git pull
docker compose up -d --build
```

Your accounts, settings and library stay in Docker volumes. Take a backup first under **Settings > Backup and restore** if you like.

---

## Still stuck

Open **Diagnostics**, press **Copy safe report** (it leaves out keys and passwords), and open an issue on GitHub with it and the steps that led to the problem.
