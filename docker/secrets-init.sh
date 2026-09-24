#!/bin/sh
# Makes each *arr service's API key, once, in the shared "secrets" volume.
#   1. A key already saved there stays (rerunning changes nothing).
#   2. Otherwise a key you set in .env (RADARR_API_KEY and so on) is used.
#   3. Otherwise the key an existing install already has in its config is kept,
#      so upgrading never locks the app out of a running stack.
#   4. Otherwise a random one is generated: a new install has no shared keys.
# To rotate one: delete /secrets/<name>, clear its key, recreate the stack.
set -eu
gen() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

for app in radarr sonarr prowlarr lidarr; do
  file="/secrets/$app"
  [ -s "$file" ] && continue
  upper=$(echo "$app" | tr 'a-z' 'A-Z')
  value=$(eval "echo \"\${${upper}_API_KEY:-}\"")
  [ -z "$value" ] && value=$(sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' "/cfg/$app/config.xml" 2>/dev/null | head -1)
  [ -z "$value" ] && value=$(gen)
  printf '%s' "$value" > "$file"
  chmod 644 "$file"
  echo "secrets: $app key ready"
done

file=/secrets/bazarr
if [ ! -s "$file" ]; then
  value="${BAZARR_API_KEY:-}"
  [ -z "$value" ] && value=$(sed -n 's/^ *apikey: *//p' /cfg/bazarr/config/config.yaml 2>/dev/null | head -1)
  [ -z "$value" ] && value=$(gen)
  printf '%s' "$value" > "$file"
  chmod 644 "$file"
  echo "secrets: bazarr key ready"
fi

# Shared secret between the dashboard and Watchtower (only used with the auto-update profile).
file=/secrets/watchtower
if [ ! -s "$file" ]; then
  gen > "$file"
  chmod 644 "$file"
  echo "secrets: watchtower token ready"
fi
