# Privacy: anonymous search and downloads

Two separate things, two separate tools. Neither is on by default.

- **Search** (Prowlarr asking indexer sites for releases) is plain web traffic. **Tor** fits this well and needs no account.
- **Downloads** (qBittorrent's BitTorrent traffic) is peer-to-peer. Tor is unsuitable and often against tracker rules for this; a **VPN** fits instead.

Using both together is normal: Tor for search, a VPN for the download client.

## Tor for search (bundled, no account needed)

```bash
docker compose --profile tor up -d
```

This starts a small Tor SOCKS5 proxy, reachable from the other containers at `tor:9050`. It needs no account, no configuration, and no payment. It only affects services you point at it; nothing routes through it automatically.

**To search over Tor:**

1. Start the profile above.
2. Open Prowlarr (`http://localhost:9696`) directly: **Settings > Indexer Proxies > Add > SOCKS5**, host `tor`, port `9050`, leave username and password blank, save.
3. On the indexer(s) you want to go through Tor: **Settings > Indexers**, edit the indexer, add a tag (for example `tor`), and give the same tag to the proxy you just added. Prowlarr applies a proxy to every indexer that shares its tag.

**To send virtuallyView's own outbound calls over Tor** (Wikipedia, MusicBrainz, cover art, search suggestions): Settings > Server > Outbound proxy, choose Tor, host `tor`, port `9050`. Radarr, Sonarr, Lidarr and qBittorrent never go through this; it only covers the app's own public lookups.

**Verify it is real Tor**, from the server:

```bash
docker compose --profile tor exec tor sh -c \
  "wget -qO- --header='Accept: text/plain' http://check.torproject.org/api/ip 2>/dev/null"
```

Should print `{"IsTor":true, ...}` with an exit address that is not your own.

**If an indexer you tagged for Tor stops answering:** the `tor` profile must be running (`docker compose ps`), and some sites refuse connections from known Tor exit nodes outright; that is the site's choice, not a bug here.

## VPN for downloads

```bash
cp .env.example .env
# fill in VPN_WIREGUARD_PRIVATE_KEY and, if needed, VPN_SERVICE_PROVIDER
docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
```

This routes qBittorrent's traffic through [gluetun](https://github.com/qdm12/gluetun), an open-source VPN client container, so your ISP sees only an encrypted tunnel, not torrent traffic. The overlay does not touch search, browsing, or any other service.

**Supported providers** (gluetun's own WireGuard provider list, checked against the running image): `protonvpn`, `mullvad`, `airvpn`, `ivpn`, `nordvpn`, `surfshark`, `windscribe`, `fastestvpn`, or `custom` for any other WireGuard-based provider. Set `VPN_SERVICE_PROVIDER` in `.env` to one of these.

A few notes on picking one, without endorsing any single provider:

- **Mullvad** and **IVPN** accept anonymous payment and publish independently audited no-logs claims; among the supported list they ask for the least identifying information to sign up.
- **ProtonVPN** is the current default here mainly because it has a free tier, useful for testing this overlay before paying for anything.
- **AirVPN** is community-run and open about its infrastructure.
- Whichever you pick, read their own privacy policy; nothing above is a guarantee.

**I have not been able to test this overlay against a live tunnel** while writing it: every provider above requires a paid or registered account, and none was available to verify with. The compose file's syntax is validated and the service starts, but the tunnel itself is unverified. If you set it up, `scripts/doctor.sh` checks that qBittorrent's visible IP is the VPN's, not yours; please open an issue if something is wrong.

**Why Tor is not offered for the download client itself:** BitTorrent over Tor leaks your real IP through peer exchange and DHT regardless of the proxy, is blocked by most trackers, and goes against the Tor Project's own exit policy. This is a well-known limitation of Tor, not a gap in this project.
