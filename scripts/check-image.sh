#!/bin/sh
# Fails if a built image contains files that must never be published.
# Usage: scripts/check-image.sh <image>
set -eu
IMAGE="${1:?usage: check-image.sh <image>}"
ENGINE="$(command -v docker || command -v podman)"
LISTING="$("$ENGINE" run --rm --entrypoint sh "$IMAGE" -c 'find /app -not -path "*/node_modules/*" \( -type f -o -type d \)' )"
BAD="$(printf '%s\n' "$LISTING" | grep -E '(^|/)(\.dev|\.git|tests|docs|\.env[^/]*|prompt[^/]*\.md|plan\.md|fixes\.md|users\.json|sessions\.json|auth\.json|integrations\.json|relay\.key|live-tv\.json|kiwix\.json|homelab-apps\.json|ai-digest\.json|ai-settings\.json|theme-settings\.json|backups|trickplay|recordings|app\.sqlite[^/]*|[^/]*\.(log|pem|key|tar\.gz|tgz|sqlite[^/]*)|id_(rsa|ed25519))$' || true)"
if [ -n "$BAD" ]; then
  echo "Image contains files that should not be published:" >&2
  printf '%s\n' "$BAD" >&2
  exit 1
fi
echo "Image contents look clean ($(printf '%s\n' "$LISTING" | wc -l | tr -d ' ') entries checked)."
