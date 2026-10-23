#!/bin/sh
set -eu

CACHE_DIR="${ZEBRA_CACHE_DIR:-/var/cache/zebra}"
mkdir -p "$CACHE_DIR"
chmod -R 0777 "$CACHE_DIR"

exec zebrad -c /etc/zebra/zebrad.toml start
