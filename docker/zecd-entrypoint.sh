#!/bin/sh
# Self-initializing funder zecd for THE DERELICT. Restores the demo seed from
# ZECD_MNEMONIC on a fresh volume (fail-fast if unset — never mint a wallet
# nobody holds), waits for the bootstrap job to mine the bring-up blocks
# (zecd init validates the birthday against the chain), then execs zecd.
# Invoked as `sh` explicitly so a Windows git checkout without exec bits
# still runs it.
set -eu

DATADIR=/var/lib/zecd
WALLET_DIR="$DATADIR/default"
ZECD_BIRTHDAY="${ZECD_BIRTHDAY:-2}"
ZEBRA_RPC="${ZEBRA_RPC:-http://zebra:18234/}"
CONF=/etc/zecd/zecd.toml

wait_for_chain() {
  i=0
  while [ "$i" -lt 900 ]; do
    resp=$(wget -qO- \
      --post-data='{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' \
      --header='Content-Type: application/json' \
      "$ZEBRA_RPC" 2>/dev/null || true)
    height=$(printf '%s' "$resp" | sed -n 's/.*"result":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    if [ -n "$height" ] && [ "$height" -ge "$ZECD_BIRTHDAY" ]; then
      echo "zebra height $height >= birthday $ZECD_BIRTHDAY"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "zebra never reached height $ZECD_BIRTHDAY" >&2
  exit 1
}

if [ ! -d "$WALLET_DIR" ]; then
  if [ -z "${ZECD_MNEMONIC:-}" ]; then
    echo "ZECD_MNEMONIC not set; refusing to create a random wallet" >&2
    echo "set it in .env (see .env.example) or the compose environment" >&2
    exit 1
  fi
  wait_for_chain
  printf '%s\n' "$ZECD_MNEMONIC" |
    zecd --datadir "$DATADIR" --conf="$CONF" init --restore --birthday "$ZECD_BIRTHDAY"
fi

exec zecd --datadir "$DATADIR" --conf="$CONF"
