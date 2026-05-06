# obfswrap

Standalone encrypted UDP wrapper for stock WireGuard. This folder is independent from the existing `bin/` and `src/` wrapper implementation.

## Packet Format

Public UDP payload:

```text
[key_id:3] [nonce:12] [ciphertext] [tag:8]
```

There is no public prefix and no padding.

Encrypted plaintext:

```text
[version:1] [inner_length:2] [raw_wireguard_packet]
```

The current cipher is `chacha20-poly1305` from Node's built-in `node:crypto`, with a 12-byte nonce and 8-byte authentication tag.

## Secret Sources

Use exactly one secret source on both client and server.

Derived on demand from a shared seed and salt:

```bash
node obfswrap/bin/obfswrap.js server \
  --listen 0.0.0.0:9091 \
  --wireguard 127.0.0.1:51820 \
  --seed-hex 9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa \
  --salt iran-home-v1
```

```bash
node obfswrap/bin/obfswrap.js client \
  --listen 127.0.0.1:51821 \
  --remote SERVER_IP:9091 \
  --seed-hex 9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa \
  --salt iran-home-v1 \
  --key-id 999999
```

Or load a list from a file:

```bash
node obfswrap/bin/obfswrap.js server \
  --listen 0.0.0.0:9091 \
  --wireguard 127.0.0.1:51820 \
  --secrets ./secrets.txt
```

```bash
node obfswrap/bin/obfswrap.js client \
  --listen 127.0.0.1:51821 \
  --remote SERVER_IP:9091 \
  --secrets ./secrets.txt \
  --key-id 999999
```

## Deterministic Secret Generation

Generate the same list independently on client and server by using the same `--seed-hex`, `--salt`, `--count`, and `--start`.

```bash
node obfswrap/bin/generate-secrets.js \
  --seed-hex 9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa \
  --salt iran-home-v1 \
  --count 1000000 \
  --out secrets.txt
```

Each output line is one 32-byte secret encoded as 64 hex characters.

The derivation is deterministic:

```text
secret[key_id] = HMAC-SHA256(seed, "obfswrap-secret-v1" || 00 || salt || 00 || key_id_3_bytes)
```

For one million secrets, `key_id = 999999` is encoded as:

```text
0f423f
```

## Notes

- `--key-id` is a 3-byte integer from `0` to `16777215`.
- `--seed-hex` must be 32 random bytes encoded as 64 hex characters.
- The wrapper secret is separate from WireGuard keys.
- The real server IP still needs a route exception on full-tunnel clients, same as the original local-wrapper setup.
