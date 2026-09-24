# HTTPS

virtuallyView speaks plain HTTP. On your home network that is usually fine. If you open it to the internet, or want other devices to trust the address, put a reverse proxy with HTTPS in front. Do this before exposing the server: sign-in cookies and passwords cross the network.

## Caddy (included)

The repository has an overlay that adds [Caddy](https://caddyserver.com), which gets and renews certificates by itself.

```bash
VV_DOMAIN=media.example.com docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

- **A real domain.** Point its DNS at your public IP, forward ports 80 and 443 to this machine, and Caddy obtains a Let's Encrypt certificate on first start.
- **`localhost` (the default).** Caddy makes a certificate from its own authority. Browsers warn until you trust it (`docker compose exec caddy caddy trust`, or import `/data/caddy/pki/authorities/local/root.crt`).
- The overlay publishes the app only on `127.0.0.1:3000`, so the only way in from outside is through Caddy. It needs Docker Compose 2.24 or newer. On older versions or podman-compose, remove the `ports` line for `app` in `docker-compose.yml` yourself.

The app marks its session cookie `Secure` whenever the request arrives over HTTPS (it reads `X-Forwarded-Proto`, which Caddy sets). The app only believes forwarded headers from a proxy you name: the Caddy overlay sets `TRUST_PROXY=loopback,uniquelocal` for you. With any other proxy, set `TRUST_PROXY` on the app to the proxy's address, a hop count such as `1`, or keywords like `loopback,uniquelocal`. Left unset (the default), forwarded headers are ignored, so nobody can fake their address to dodge the sign-in limit.

## Another proxy

Any reverse proxy works. It must:

- forward to port 3000 of the app,
- send `X-Forwarded-Proto` and `X-Forwarded-For`,
- not buffer responses (video and conversion streams are long-lived), and allow large request bodies if you want to restore backups through it.

nginx sketch:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_buffering off;
  client_max_body_size 1g;
}
```

## Without opening ports

A VPN such as WireGuard or Tailscale gives other devices a private address for the server without exposing it to the internet. Use that address in Settings > Server > Connect other devices.

## Checklist before exposing it

1. Change the seeded API keys and qBittorrent login ([docker/seed/README.md](../docker/seed/README.md)).
2. Use passwords longer than four characters.
3. Keep sign-up closed unless you want strangers to be able to create accounts.
4. Keep Radarr, Sonarr and the other services on `127.0.0.1` (the compose file already does).
