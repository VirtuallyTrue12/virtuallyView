#!/usr/bin/env bash
# Diagnose VirtuallyView step by step. Written for every skill level: prints
# what each check means and the exact fix. Read-only; changes nothing.
set -uo pipefail

pass=0; warn=0; failn=0
ok()   { printf '  \033[0;32mPASS\033[0m %s\n' "$*"; pass=$((pass+1)); }
warn() { printf '  \033[0;33mWARN\033[0m %s\n' "$*"; warn=$((warn+1)); }
bad()  { printf '  \033[0;31mFAIL\033[0m %s\n' "$*"; failn=$((failn+1)); }
step() { printf '\n\033[1;36m==\033[0m \033[1m%s\033[0m\n' "$*"; }

step "1. Docker"
command -v docker >/dev/null 2>&1 && ok "docker CLI present" || failn=1
docker info >/dev/null 2>&1 && ok "docker daemon reachable" || { echo "       fix: start docker/podman, then re-run this script"; exit 1; }

step "2. Containers"
docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | while read -r svc status; do
  case "$svc" in "") continue ;; esac
  echo "$svc: $status"
done
for svc in app radarr sonarr prowlarr lidarr qbittorrent bazarr nzbget; do
  state=$(docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | awk -v s="$svc" '$1==s{print $2, $3}')
  [ -z "$state" ] && { echo "  MISSING  $svc (not created)"; continue; }
  case "$state" in Up*) ok "$svc running" ;; *) warn "$svc: $state" ;; esac
done

step "3. Dashboard API"
curl -fs --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && ok "API healthy on :3000" || warn "API not answering on :3000"

step "4. Service connectivity (from containers)"
for c in radarr sonarr prowlarr lidarr; do
  if docker exec appletvopensourcce-$c-1 sh -c 'nslookup yts.mx 1.1.1.1 >/dev/null 2>&1 || nslookup example.com >/dev/null 2>&1'; then
    ok "$c DNS works"
  else
    warn "$c DNS broken (indexers cannot search). fix: docker compose up -d --force-recreate $c"
  fi
done

step "5. Indexers"
echo "  Radarr needs at least one enabled indexer to find movies."
KR=$(grep -oP 'RADARR_API_KEY=\K[A-Za-z0-9]+' docker-compose.yml 2>/dev/null | head -1)
if [ -n "$KR" ]; then
  count=$(curl -fs -H "X-Api-Key: $KR" http://127.0.0.1:7878/api/v3/indexer 2>/dev/null | grep -c '"enable": true' || true)
  [ "$count" -gt 0 ] && ok "radarr has $count enabled indexer(s)" || warn "no enabled indexers in Radarr; run scripts/fix-indexers.sh or add one in Prowlarr UI"
fi

step "6. VPN (optional)"
if docker ps --format '{{.Names}}' | grep -q 'vpn-1'; then
  ip=$(docker exec appletvopensourcce-qbittorrent-1 wget -qO- --timeout=8 ifconfig.me 2>/dev/null)
  [ -n "$ip" ] && ok "qBittorrent exit IP: $ip (verify it is not your home IP)" || warn "could not read exit IP"
else
  echo "  VPN not active (optional). See docker-compose.vpn.yml header for setup."
fi

step "7. Disk space"
df -h . | tail -1 | awk '{print "  free:", $4}'

printf '\nSummary: %d passed, %d warnings, %d failures\n' "$pass" "$warn" "$failn"
exit $failn
