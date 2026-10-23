# Funder wallet image

This directory vendors the Linux x86-64 **zecd 0.8.2** release binary used as the regtest
funder wallet.

- binary: `zecd` (static-pie, 88 MB)
- SHA-256: `32b6afcce71dcd0d97a105efd6b20608eb437f0a3dca1a2e4b5a243759b7c9d6`
- license: see `zecd licenses` in the running container (third-party crate licenses are
  bundled by zecd); the DERELICT code itself is MIT

The image builds from the repository root using `docker/zecd/Dockerfile` and runs
`derelict-entrypoint.sh`, which:

1. waits for Zebra to reach the wallet birthday,
2. restores the demo seed from `ZECD_MNEMONIC` on a fresh volume (the public BIP-39 test
   vector in `.env.example`), and
3. starts zecd with `regtest/zecd.toml`. Set `ZECD_BACKEND` to override the default
   `zebra://zebra:18234` backend URL for a deployment using a different private hostname.

To use a locally built zecd instead, replace `docker/zecd/zecd` with your binary and
rebuild:

```bash
docker compose build funder
```

The binary is vendored because the demo has to run without a network fetch and because
the exact release is pinned. It is not part of the game logic.
