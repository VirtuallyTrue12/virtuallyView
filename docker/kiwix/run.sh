#!/bin/sh
# Serves every .zim in /data, and downloads the libraries named in KIWIX_ZIMS
# (space separated "folder/name-prefix", newest version is picked) that are not
# there yet. Downloads resume after a restart, and the server reloads each time
# one finishes, so libraries appear as they arrive.
cd /data || exit 1
PID=
trap 'kill $PID 2>/dev/null; exit 0' TERM INT

serve() {
  if [ -n "$PID" ]; then kill $PID 2>/dev/null; wait $PID 2>/dev/null; fi
  if ls /data/*.zim >/dev/null 2>&1; then
    /usr/local/bin/kiwix-serve --port=8080 /data/*.zim &
    PID=$!
  else
    PID=
  fi
}

fetch() {
  folder=${1%%/*}; prefix=${1#*/}
  file=$(wget -qO- "https://download.kiwix.org/zim/$folder/" 2>/dev/null | grep -o "href=\"${prefix}_[0-9][0-9-]*[a-z]*\.zim\"" | sed 's/href="//;s/"//' | sort | tail -1)
  if [ -z "$file" ]; then echo "kiwix: nothing found for $1"; return 1; fi
  [ -f "/data/$file" ] && return 1
  echo "kiwix: downloading $file"
  if wget -c -q -O "/data/$file.part" "https://download.kiwix.org/zim/$folder/$file"; then
    mv "/data/$file.part" "/data/$file"
    for old in /data/${prefix}_*.zim; do [ "$old" != "/data/$file" ] && [ -f "$old" ] && rm -f "$old"; done
    echo "kiwix: $file ready"
    return 0
  fi
  echo "kiwix: download of $file failed; it will be retried on the next start"
  return 1
}

serve
if [ -z "$PID" ] && [ -z "$KIWIX_ZIMS" ]; then
  echo "No .zim files in the kiwix-data volume yet."
  echo "Set KIWIX_ZIMS in .env (see docs/kiwix.md) or copy a file from https://library.kiwix.org into it, then: docker compose restart kiwix"
  sleep infinity
fi
for z in $KIWIX_ZIMS; do
  if fetch "$z"; then serve; fi
done
echo "kiwix: libraries up to date"
[ -n "$PID" ] && wait $PID
sleep infinity
