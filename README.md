# wgdpi

`wgdpi` is a small UDP wrapper for testing a DPI-resistant WireGuard transport shape while keeping stock WireGuard on both client and server.

It exists because some networks can identify and disrupt regular WireGuard. WireGuard normally sends recognizable UDP packets such as handshake initiation `01 00 00 00`, handshake response `02 00 00 00`, and transport data `04 00 00 00` directly at the start of the UDP payload. This project moves the raw WireGuard packet inside a simple envelope and optionally pads replies, so the public UDP traffic no longer starts with the stock WireGuard signature.

The project is a prototype and transport experiment. It is not a replacement for WireGuard cryptography, and it does not modify or weaken WireGuard encryption. Stock WireGuard still handles keys, handshakes, routing, and packet encryption.

## What It Does

The client wrapper accepts stock WireGuard UDP packets from a local WireGuard app and sends wrapped packets to the server:

```text
00 00 00 00 + 2-byte little-endian length + raw WireGuard packet + random padding
```

The server wrapper receives the public wrapped packets, extracts the raw WireGuard payload, and forwards it to a local stock WireGuard server.

With `--reply-mode wrapped`, server-to-client WireGuard replies are wrapped too. This mode has been more reliable on networks that block or fingerprint plain WireGuard responses.

## Architecture

Client:

```text
WireGuard app -> 127.0.0.1:51821 -> wgdpi client wrapper -> SERVER_IP:9091
```

Server:

```text
public UDP/9091 -> wgdpi server wrapper -> 127.0.0.1:51820 -> stock WireGuard wg0
```

The WireGuard app is configured with a local endpoint:

```ini
Endpoint = 127.0.0.1:51821
```

The wrapper knows the real server endpoint:

```text
SERVER_IP:9091
```

## Why It Exists

This project is useful when:

- Stock WireGuard does not connect from a restrictive network.
- A provider VPN works by using direct UDP with modified packet shape or padding.
- You want to self-host a similar experiment without patching WireGuard source code first.
- You want to keep normal WireGuard configs and keys while testing transport obfuscation.

This project does not solve every blocking case. It will not help if all UDP is blocked, the server IP or hosting ASN is blocked, or a firewall specifically learns and blocks this wrapper pattern.

## Current Protocol

Wrapped packet layout:

```text
offset 0:  4-byte wrapper prefix, default 00 00 00 00
offset 4:  uint16 little-endian raw WireGuard packet length
offset 6:  raw WireGuard packet
tail:      random padding up to --pad-to bytes, or a random --pad-min/--pad-max target
```

Example wrapped 148-byte WireGuard handshake initiation:

```text
00 00 00 00 94 00 01 00 00 00 ...
```

Meaning:

```text
00 00 00 00    wrapper prefix
94 00          length = 148
01 00 00 00    raw WireGuard handshake initiation
```

## Known-Good Baseline

Use this profile first when testing:

```text
Server wrapper: --pad-to 1510 --reply-mode wrapped
Client wrapper: --pad-to 1510
WireGuard MTU: 1280
PersistentKeepalive: 25
Split tunnel AllowedIPs: 10.44.0.0/24
Full tunnel AllowedIPs: 0.0.0.0/0
```

For some networks, a less fragmented profile may be more stable:

```text
Server wrapper: --pad-to 1280 --reply-mode wrapped
Client wrapper: --pad-to 1280
WireGuard MTU: 1180
PersistentKeepalive: 10
```

Test the baseline first, then tune.

For a more fingerprint-resistant profile after the baseline works, use matching random padding and prefix settings on both sides:

```text
Server wrapper: --pad-min 900 --pad-max 1280 --prefix 7a21c90e --reply-mode wrapped
Client wrapper: --pad-min 900 --pad-max 1280 --prefix 7a21c90e
WireGuard MTU: 1100
```

## Quick Start

Server:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --reply-mode wrapped
```

Client:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-to 1510
```

Randomized profile example:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-min 900 --pad-max 1280 --prefix 7a21c90e --reply-mode wrapped
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-min 900 --pad-max 1280 --prefix 7a21c90e
```

If a network path fails with random padding bytes, use `--pad-bytes zero` to reproduce the legacy padding byte shape while keeping the latest code:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --pad-bytes zero --reply-mode wrapped
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-to 1510 --pad-bytes zero
```

## Documentation

- `docs/server-setup.md`: Ubuntu server setup, WireGuard config, iptables, Oracle/Docker notes, and systemd service.
- `docs/client-setup.md`: macOS client wrapper, split tunnel, full tunnel, route exception, and troubleshooting.
- `docs/improvements.md`: stability and anti-fingerprinting improvements to make this more robust against DPI.
- `docs/plan.md`: original implementation plan and protocol rationale.

## Limitations

- IPv4 UDP only in the current implementation.
- The wrapper does not hide the server IP or the fact that UDP is being used.
- The default fixed prefix and fixed packet size can itself become fingerprintable if random padding and a custom prefix are not configured.
- The client wrapper requires a local process on the client machine.
- Full tunnel mode requires a route exception for the real server IP on macOS.
- Multi-client support is best-effort and should be tested before relying on it.

## Verification

Server public capture:

```bash
sudo tcpdump -ni any udp port 9091
```

Server loopback capture:

```bash
sudo tcpdump -ni lo udp port 51820
```

With wrapped replies, public traffic should show wrapped packets both ways:

```text
client -> server UDP length 1510
server -> client UDP length 1510
```

With `--pad-min 900 --pad-max 1280`, public UDP lengths should vary within that range unless the inner WireGuard packet is larger than the selected target.

For high-volume downlink traffic, `--reply-mode mixed` wraps handshake/control replies but sends transport data replies plain. `--reply-mode adaptive` keeps transport replies wrapped but does not force fixed-size padding on transport replies, reducing downlink padding amplification without exposing plain WireGuard replies.

Loopback traffic should show normal WireGuard:

```text
127.0.0.1.X -> 127.0.0.1.51820 UDP length 148
127.0.0.1.51820 -> 127.0.0.1.X UDP length 92
```

Check WireGuard:

```bash
sudo wg show
```

Run tests:

```bash
npm test
```

## Safety Notes

Do not flush iptables or nftables on servers that run Docker:

```bash
sudo iptables -F
sudo iptables -t nat -F
sudo nft flush ruleset
```

Those commands can break Docker networking and Traefik routing. Add narrow rules for `UDP/9091`, `wg0`, forwarding, and NAT instead.
