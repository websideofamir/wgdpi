# wgwrap prototype

`wgwrap` is a small UDP wrapper prototype for testing a provider-like WireGuard packet shape without modifying WireGuard source code.

It wraps client-to-server WireGuard UDP payloads as:

```text
00 00 00 00 + 2-byte little-endian inner length + raw WireGuard packet + zero padding
```

See `docs/wgwrap.md` for the server, macOS client, routing, and verification guide.

## Quick Commands

Server:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820
```

Client:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091
```

Run tests:

```bash
npm test
```
