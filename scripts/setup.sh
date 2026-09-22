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
  ok "created .env from .env.example (edit it later for VPN, optional)"
else
  ok ".env present"
fi

step "3/6 Starting the media stack"
echo "First start downloads images (~2 GB) and runs one-time seeds."
if ! docker compose up -d; then
  fail "compose failed. If this mentions overlay/btrfs, reboot into the newest kernel and re-run."
  exit 1
fi
ok "stack started"

step "4/6 Waiting for services to become healthy"
echo "This can take a few minutes on first run."
for i in $(seq 1 60); do
  unhealthy=$(docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | grep -vc 'healthy\|Up' || true)
  up=$(curl -fs --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && echo yes || echo no)
  [ "$up" = yes ] && break
  sleep 5
done
if ! curl -fs --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  fail "Dashboard did not come up. Run: docker compose logs app | tail -50"
  exit 1
fi
ok "dashboard is up on http://127.0.0.1:3000"

step "5/6 Verifying integrations"
sleep 5
token=$(curl -fs -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"${DASH_USER:-root}\",\"password\":\"${DASH_PASS:?Set DASH_PASS env or log in via UI}\"}" \
  | sed -n 's/.*"authenticated":true.*/&/p')
if [ -z "$token" ]; then
  warn "Could not auto-verify integrations (login failed?). Open the dashboard and check Settings."
else
  echo "  Opening http://127.0.0.1:3000 in your browser will show Setup if this is the first run."
fi

step "6/6 Done"
echo "Next steps:"
echo "  1. Open http://127.0.0.1:3000 and create your account (first run only)."
echo "  2. Optional VPN: cp .env.example .env, fill VPN_* keys, then:"
echo "     docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d"
echo "  3. Run scripts/doctor.sh anytime to diagnose problems step by step."
