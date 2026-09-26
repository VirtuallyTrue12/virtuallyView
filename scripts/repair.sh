#!/usr/bin/env bash
# virtuallyView: fix the usual problems on the server in one go.
#
#   ./scripts/repair.sh
#
# It is what the "Fix everything" button in Settings > Health and repair points to when a problem needs the
# machine itself (the helper container is off, a media folder is not writable, a container engine socket is
# not enabled). It works out how the stack was started (Docker or Podman, which overlay files, which
# profiles), repairs what it finds, and asks for your password only when something really needs it.
# Running it again is safe: it changes nothing that already works.
set -u
cd "$(dirname "$0")/.." || exit 1

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
FIXED=0

ENGINE=""
if command -v docker >/dev/null 2>&1; then ENGINE=docker; elif command -v podman >/dev/null 2>&1; then ENGINE=podman; fi
[ -z "$ENGINE" ] && { echo "Neither Docker nor Podman is installed."; exit 1; }
if [ "$ENGINE" = podman ] || docker --version 2>/dev/null | grep -qi podman || [ -e /etc/containers/nodocker ] || docker info 2>/dev/null | grep -qi podman; then
  ROOTLESS_PODMAN=1
else
  ROOTLESS_PODMAN=0
fi
[ "$(id -u)" = 0 ] && ROOTLESS_PODMAN=0
COMPOSE=(docker compose)
[ "$ENGINE" = podman ] && ! docker compose version >/dev/null 2>&1 && COMPOSE=(podman compose)

sudo_ok() {
  # Ask for the password once, and only when it is needed.
  [ "$(id -u)" = 0 ] && return 0
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n true 2>/dev/null || { echo "  This step needs your administrator password."; sudo -v; }
}

say "Container engine"
if [ "$ROOTLESS_PODMAN" = 1 ]; then
  SOCK="/run/user/$(id -u)/podman/podman.sock"
  if [ ! -S "$SOCK" ]; then
    systemctl --user enable --now podman.socket >/dev/null 2>&1 && { ok "Turned on the Podman socket (the helper needs it)"; FIXED=$((FIXED+1)); } || warn "Could not turn on the Podman socket: run: systemctl --user enable --now podman.socket"
  else ok "Podman socket is on"; fi
  export DOCKER_SOCK="$SOCK"
  if systemctl --user list-unit-files podman-restart.service >/dev/null 2>&1 && ! systemctl --user is-enabled podman-restart.service >/dev/null 2>&1; then
    systemctl --user enable --now podman-restart.service >/dev/null 2>&1 && { ok "Services now come back after a reboot"; FIXED=$((FIXED+1)); }
  fi
  if command -v loginctl >/dev/null 2>&1 && [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = no ]; then
    if sudo_ok; then sudo loginctl enable-linger "$USER" && { ok "Services keep running when you log out"; FIXED=$((FIXED+1)); }; fi
  fi
else
  ok "Using $ENGINE"
fi

# Work out how the stack was started, so a repair never starts it a different way (for example without the VPN).
FILES=(-f docker-compose.yml)
PROJECT_LABEL='{{index .Config.Labels "com.docker.compose.project.config_files"}}'
APP="$($ENGINE ps -a --format '{{.Names}}' 2>/dev/null | grep -E '(^|-)app-1$' | head -1)"
if [ -n "$APP" ]; then
  LIST="$($ENGINE inspect "$APP" --format "$PROJECT_LABEL" 2>/dev/null)"
  if [ -n "$LIST" ]; then
    FILES=(); IFS=',' read -ra PARTS <<<"$LIST"
    for f in "${PARTS[@]}"; do [ -f "$f" ] && FILES+=(-f "$f"); done
    [ ${#FILES[@]} -eq 0 ] && FILES=(-f docker-compose.yml)
  fi
fi
if [ ${#FILES[@]} -eq 2 ] && $ENGINE ps -a --format '{{.Names}}' 2>/dev/null | grep -q 'vpn-1$'; then
  if $ENGINE ps -a --format '{{.Names}}' | grep -q 'vpngate-config'; then FILES+=(-f docker-compose.vpn-free.yml); else FILES+=(-f docker-compose.vpn.yml); fi
fi
PROFILES="${COMPOSE_PROFILES:-$(grep -E '^COMPOSE_PROFILES=' .env 2>/dev/null | cut -d= -f2-)}"
case ",$PROFILES," in *,helper,*) ;; *) PROFILES="${PROFILES:+$PROFILES,}helper" ;; esac
export COMPOSE_PROFILES="$PROFILES"
say "Starting the stack the way it was started before (${FILES[*]})"

# Media folders on the computer must exist and be writable by the apps.
say "Media folders"
for var in MOVIES_DIR TV_DIR MUSIC_DIR; do
  dir="$(grep -E "^$var=" .env 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  [ -z "$dir" ] && continue
  if [ ! -d "$dir" ]; then mkdir -p "$dir" 2>/dev/null || { sudo_ok && sudo mkdir -p "$dir" && sudo chown "$(id -u):$(id -g)" "$dir"; }; [ -d "$dir" ] && { ok "Created $dir"; FIXED=$((FIXED+1)); }; fi
  if [ -d "$dir" ] && [ ! -w "$dir" ]; then
    if sudo_ok; then sudo chown -R "$(id -u):$(id -g)" "$dir" && { ok "Fixed permissions on $dir"; FIXED=$((FIXED+1)); }; else warn "$dir is not writable by you"; fi
  else [ -d "$dir" ] && ok "$dir"; fi
done

# A download client left half-created (or outside the VPN) blocks the whole stack with "port 6881 already in use".
say "Downloads and VPN"
QB="$($ENGINE ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'qbittorrent-1$' | head -1)"
VPN="$($ENGINE ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'vpn-1$' | head -1)"
if [ -n "$QB" ] && [ -n "$VPN" ]; then
  MODE="$($ENGINE inspect "$QB" --format '{{.HostConfig.NetworkMode}}' 2>/dev/null)"
  STATE="$($ENGINE inspect "$QB" --format '{{.State.Status}}' 2>/dev/null)"
  case "$MODE" in
    container:*) [ "$STATE" = running ] && ok "qBittorrent is inside the VPN" || { $ENGINE rm -f "$QB" >/dev/null 2>&1; warn "qBittorrent was not running; recreating it"; } ;;
    *) $ENGINE rm -f "$QB" >/dev/null 2>&1; warn "qBittorrent was outside the VPN; recreating it inside" ; FIXED=$((FIXED+1)) ;;
  esac
fi

say "Bringing everything up"
"${COMPOSE[@]}" "${FILES[@]}" up -d 2>&1 | grep -Ev 'nodocker|external compose provider|^$' | tail -8
"${COMPOSE[@]}" "${FILES[@]}" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -Ei 'unhealthy|exited|created' | while read -r line; do warn "$line"; done

say "Reconnecting the apps"
"${COMPOSE[@]}" "${FILES[@]}" build provision >/dev/null 2>&1
"${COMPOSE[@]}" "${FILES[@]}" run --rm --no-deps provision 2>&1 | grep -E '^\[provision\]' | tail -12

say "Done"
if [ "$FIXED" -gt 0 ]; then echo "Repaired $FIXED thing(s). Open Settings > Health and repair and press Check again."; else echo "Nothing needed repair on this machine. Open Settings > Health and repair for anything else."; fi
