# Improvements And DPI Resistance

This document lists improvements that can make `wgdpi` more stable and harder to fingerprint.

The current implementation is intentionally simple. It proves that wrapping WireGuard packets can work, but the exact wrapper is also easy to fingerprint if a firewall specifically targets it.

## Current Fingerprint

Default public packets still have recognizable traits unless the configurable hardening options are enabled:

- Default prefix: `00 00 00 00`.
- Fixed length field at byte offset `4`.
- Raw WireGuard packet starts at byte offset `6`.
- Padding length is fixed by default.
- Many packets have the exact same public UDP length, for example `1510`.
- Keepalive and handshake timing still follows normal WireGuard behavior.
- Traffic is still direct UDP to one server IP and one server port.

This may bypass simple WireGuard signature matching, but it can become its own signature.

## Highest-Value Improvements

### Random Padding Length

Implemented with `--pad-min` and `--pad-max`.

Instead of always padding to a fixed size, choose a random target within a range:

```text
--pad-min 900
--pad-max 1280
```

Public packet sizes would vary:

```text
934, 1172, 1011, 1278, 1086
```

This is better than:

```text
1510, 1510, 1510, 1510
```

### Random Padding Bytes

Padding bytes are filled with random data instead of zeros.

The receiver already uses the embedded length field, so padding content does not need to be meaningful.

### Configurable Prefix

Implemented with `--prefix`.

Make the prefix configurable per deployment:

```text
--prefix 7a21c90e
```

This avoids every deployment using:

```text
00 00 00 00
```

The same prefix must be configured on client and server.

### Optional Wrapped Replies

Keep `--reply-mode wrapped` as the default for restrictive networks. Plain replies expose stock WireGuard response packets:

```text
02 00 00 00 ...
```

Wrapped replies avoid that signature on the return path.

### Avoid Fragmentation When Possible

`--pad-to 1510` creates large UDP payloads. The full IPv4 packet is larger than typical Ethernet MTU:

```text
1510 UDP payload + 8 UDP header + 20 IPv4 header = 1538 bytes
```

That usually causes IP fragmentation. Fragmentation can help against weak DPI, but it can also cause instability.

Test both profiles:

```text
High-obfuscation baseline: pad-to 1510, WG MTU 1280
Lower-fragmentation profile: pad-to 1280, WG MTU 1180
```

The best value depends on the network path.

## Stability Improvements

### MTU And MSS Clamping

If ping works but websites hang, add TCP MSS clamping on the server:

```bash
sudo iptables -t mangle -A FORWARD -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
sudo iptables -t mangle -A FORWARD -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

Persist those rules in `wg0.conf` only after testing.

### Keepalive Tuning

Restrictive NATs can expire UDP mappings quickly. Test:

```text
PersistentKeepalive = 10
PersistentKeepalive = 15
PersistentKeepalive = 25
```

Lower values keep NAT state alive but create more regular traffic. Higher values are quieter but may disconnect more often.

### Multiple Padding Profiles

Different networks may prefer different profiles:

```text
Profile A: pad-to 1510, MTU 1280, keepalive 25
Profile B: pad-to 1280, MTU 1180, keepalive 10
Profile C: random pad 900-1280, MTU 1100, keepalive 10
```

The client and server should use compatible padding behavior.

### Better Logging

Partially implemented with startup settings, endpoint-change logs, first drop/error warnings, and periodic traffic summaries.

Add counters for:

- Wrapped packets received.
- Plain packets received.
- Packets dropped as malformed.
- Packets forwarded to local WireGuard.
- Replies sent to clients.
- Last client endpoint.

This will make field debugging much faster.

## Protocol Hardening Ideas

### Lightweight Authentication For Wrapper Header

Add an HMAC or keyed tag outside the WireGuard payload:

```text
prefix + length + nonce + tag + wireguard packet + padding
```

Benefits:

- Server can drop random garbage cheaply.
- Reduces abuse of the public UDP port.
- Allows per-deployment packet formats.

Tradeoff:

- More custom configuration.
- More bytes overhead.

### Encrypted Envelope Metadata

Encrypt or mask the length field and prefix using a shared wrapper secret.

Current format exposes:

```text
prefix at offset 0
length at offset 4
WireGuard type at offset 6
```

A masked format can move or hide these fields.

### Packet Type Camouflage

Use different envelope layouts for handshake, keepalive, and transport packets.

Example:

```text
handshake packets: larger randomized padding
keepalive packets: random small/medium sizes
transport packets: variable padding based on payload size
```

This reduces uniformity.

### Junk Packets

Send junk UDP packets before handshake or during idle periods.

Junk packets should be authenticated or clearly distinguishable to the server wrapper, so the server can drop them without forwarding to WireGuard.

Use carefully because excessive junk can create a new fingerprint and waste bandwidth.

## Client UX Improvements

### launchd Service For macOS

Create a launchd plist so the client wrapper starts automatically before WireGuard.

Needs:

- Wrapper command.
- Server IP/port.
- Padding profile.
- Logs path.

### Route Helper

For full tunnel, the client needs a route exception:

```bash
sudo route -n add -host YOUR_SERVER_IP YOUR_CURRENT_GATEWAY
```

This should be automated with a small helper script that:

- Detects current default gateway.
- Adds or changes the host route.
- Verifies the server IP does not route through `utun`.
- Removes the route when requested.

### Native WireGuard Client Patch

If the wrapper proves useful, patching the macOS WireGuard app would improve UX.

Benefits:

- No separate local Node process.
- No local `127.0.0.1` endpoint in user config.
- Cleaner route handling.
- Easier packaging for non-technical users.

Costs:

- More complex implementation.
- Code signing and notarization work on macOS.
- Ongoing maintenance against upstream WireGuard updates.

## Server Improvements

### Stronger Multi-Client Mapping

The current server maps clients using WireGuard indexes and endpoint fallback. It should be hardened for many clients:

- Track sender indexes from handshakes.
- Track receiver indexes from responses.
- Expire mappings conservatively.
- Avoid fallback ambiguity when many clients are active.

### Rate Limits

Add per-IP rate limits for malformed packets and junk packets to avoid abuse.

### Config File

Move CLI flags into a config file:

```json
{
  "listen": "0.0.0.0:9091",
  "wireguard": "127.0.0.1:51820",
  "replyMode": "wrapped",
  "padMin": 900,
  "padMax": 1280,
  "prefix": "7a21c90e"
}
```

## Recommended Next Development Order

1. Add macOS route helper script.
2. Add launchd plist for the client wrapper.
3. Add HMAC/keyed wrapper envelope.
4. Improve multi-client mapping.
5. Consider native WireGuard client patch.
