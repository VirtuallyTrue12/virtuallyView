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

## Paranoid mode: all searching over Tor

Two lines in `.env`:

```
SEARCH_VIA_TOR=true
COMPOSE_PROFILES=tor
```

then `docker compose up -d` and run the setup again (Settings, or `docker compose run --rm provision`). It starts the bundled Tor proxy and:

- routes every Prowlarr search source through it;
- tests each source over Tor, and **switches off** the ones that do not answer, instead of letting them search directly (many sites block Tor exit nodes);
- sends the server's own lookups (metadata, covers, trailers) through Tor as well.

Tested live on this stack: 37 of 51 sources worked over Tor, a search returned 387 results from 16 sources, and with the Tor container stopped the same search returned nothing (it fails closed rather than leaking). Some sources that a home ISP blocks even worked better over Tor.

Expect fewer sources and slower searches. Set `SEARCH_VIA_TOR=false` and run the setup again to undo all of it: switched-off sources are turned back on and the proxy is removed.

Pair it with a VPN for downloads (below): your searches and your downloads then leave through different doors. This is a strong improvement, not full anonymity: the peers you download from still see the VPN's address, and Tor does not protect an account you sign in to.

## VPN for downloads

Two ways, both use [gluetun](https://github.com/qdm12/gluetun), an open-source VPN client container. Either one routes only qBittorrent's traffic; search, browsing and every other service are untouched.

### No account (VPN Gate)

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn-free.yml up -d
```

Uses [VPN Gate](https://www.vpngate.net), an open academic project of the University of Tsukuba: free public relays, no sign-up. Every start picks the best available relay; set `VPN_SERVER_COUNTRY_CODE=NL` (any two-letter code) in `.env` to choose a country.

**Read this before relying on it.** The relays are run by volunteers, and VPN Gate keeps connection logs. This hides your downloads from your internet provider; it is not anonymity, and speed and availability vary. If that matters, use a provider below.

Tested live: qBittorrent's traffic left through a VPN Gate relay (a different IP from the machine's own), and Radarr and Sonarr kept reaching qBittorrent through it.

### Your own provider (WireGuard)

```bash
cp .env.example .env
# fill in VPN_WIREGUARD_PRIVATE_KEY and VPN_SERVICE_PROVIDER
docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
```

**Supported providers** (gluetun's own WireGuard list): `protonvpn`, `mullvad`, `airvpn`, `ivpn`, `nordvpn`, `surfshark`, `windscribe`, `fastestvpn`, or `custom` for any other WireGuard-based provider.

- **Mullvad** and **IVPN** accept anonymous payment and publish audited no-logs claims; they ask for the least identifying information to sign up.
- **ProtonVPN** has a free tier, useful for trying this before paying.
- **AirVPN** is community-run and open about its infrastructure.
- Whichever you pick, read their own privacy policy; nothing above is a guarantee.

This path has the same wiring fixes as the free one (the overlay used to be rejected by Compose, and now keeps qBittorrent reachable by name), but I could only test the tunnel itself with the no-account option, since the providers above need an account.

### Checking it, and going back

`docker exec appletvopensourcce-vpn-1 wget -qO- ifconfig.me` must print an address that is not your own; `scripts/doctor.sh` checks the same. To stop using a VPN: `docker compose up -d --force-recreate qbittorrent` (without the overlay file). Note that running plain `docker compose up -d` later also puts qBittorrent back outside the VPN.

### Why Tor is not offered for downloads

BitTorrent over Tor leaks your real IP through peer exchange, is blocked by most trackers, and violates Tor's exit policy. For search, which is plain web traffic, use the Tor section above.
