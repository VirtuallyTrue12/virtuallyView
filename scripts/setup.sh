#!/usr/bin/env bash
# Step-by-step guided setup for virtuallyView. Written for every skill level:
# each step prints what it is doing, why, and the exact fix when something is
# missing. Never sends data anywhere. Safe to re-run.
set -uo pipefail

step() { printf '\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32mok\033[0m %s\n' "$*"; }
warn() { printf '  \033[0;33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[0;31mfail\033[0m %s\n' "$*"; }

step "Welcome to virtuallyView setup"
echo "This wizard installs and checks everything the dashboard needs."
echo "Nothing is sent to any server. You can re-run this script anytime."

step "1/6 Docker (Podman)"
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker CLI not found."
  echo "  Install docker or podman plus 'podman-docker', then re-run this script."
  echo "  Fedora/RHEL:  sudo dnf install podman-docker"
  echo "  Debian/Ubuntu: sudo apt install podman-docker   (or docker.io)"
  echo "  Arch/CachyOS: sudo pacman -S podman-docker"
  exit 1
fi
ok "docker CLI found"
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not reachable."
  echo "  On rootless Podman, run once and log out/in afterwards:"
  echo "    systemctl --user enable --now podman.socket podman-restart"
  echo "    sudo loginctl enable-linger \"\$USER\""
  echo "  With Docker Desktop: just start Docker Desktop."
  exit 1
fi
ok "docker daemon reachable"

step "2/6 Configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from .env.example (everything in it is optional)"
else
  ok ".env present"
fi
# Read only the settings this script needs, without running anything in .env.
PORT=$(sed -n 's/^DASHBOARD_PORT=\([0-9]\{2,5\}\)$/\1/p' .env | tail -1)
PORT=${PORT:-3000}
URL="http://127.0.0.1:${PORT}"
COMPOSE="docker compose"
if [ "${VV_RELEASE:-}" = "1" ]; then
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.release.yml"
  ok "using the published release image (VV_RELEASE=1)"
fi

step "3/6 Starting the media stack"
echo "First start downloads images (~2 GB) and runs one-time seeds."
if ! $COMPOSE up -d; then
  fail "compose failed. If this mentions overlay/btrfs, reboot into the newest kernel and re-run."
  exit 1
fi
ok "stack started"

step "4/6 Waiting for the dashboard"
echo "This can take a few minutes on first run."
for i in $(seq 1 90); do
  curl -fs --max-time 3 "$URL/api/ready" >/dev/null 2>&1 && break
  sleep 5
done
if ! curl -fs --max-time 3 "$URL/api/ready" >/dev/null 2>&1; then
  fail "The dashboard did not become ready. Run: $COMPOSE logs app | tail -50"
  exit 1
fi
ok "dashboard is ready on $URL"

step "5/6 Checking the first-time wiring"
# The one-shot setup connects the services to each other. Wait for it, then say what happened.
for i in $(seq 1 60); do
  state=$($COMPOSE ps -a --format '{{.Service}} {{.State}}' 2>/dev/null | sed -n 's/^provision //p')
  [ "$state" = "exited" ] && break
  sleep 5
done
if [ "$state" = "exited" ] && $COMPOSE logs provision 2>/dev/null | tail -20 | grep -q "Done\."; then
  ok "services are connected to each other"
else
  warn "first-time wiring did not finish cleanly. Run it again with: $COMPOSE run --rm provision"
  echo "  and see what it says: $COMPOSE logs provision | tail -30"
fi

step "6/6 Done"
echo "Next steps:"
echo "  1. Open $URL and create your account (first run only)."
echo "  2. Optional VPN with no account: docker compose -f docker-compose.yml -f docker-compose.vpn-free.yml up -d  (see docs/privacy.md)"
echo "  3. Run scripts/doctor.sh anytime to diagnose problems step by step."
