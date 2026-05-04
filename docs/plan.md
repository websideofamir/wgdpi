# wgwrap Implementation Plan

## Objective

Build a self-hosted prototype that reproduces the provider-like WireGuard packet shape seen in the capture without modifying WireGuard source code first.

The captured client-to-server packet looked like:

```text
00 00 00 00 94 00 01 00 00 00 ... zero padding
```

That means:

```text
4-byte prefix + 2-byte little-endian inner length + raw WireGuard packet + padding
```

## Phase 1: External Wrapper Prototype

Use stock WireGuard on both macOS and the server.

Client path:

```text
WireGuard app -> local UDP wrapper -> public internet -> server wrapper
```

Server path:

```text
server wrapper -> stock WireGuard server on localhost
```

This proves whether the packet transformation is enough before investing in a custom WireGuard client build.

## Protocol

Client-to-server packets are wrapped as:

```text
offset 0:  00 00 00 00
offset 4:  uint16 little-endian raw WireGuard packet length
offset 6:  raw WireGuard packet
tail:      zero padding up to --pad-to bytes
```

Default padding target:

```text
1510-byte UDP payload
```

That matches the observed packet size and intentionally produces large UDP packets similar to the provider capture.

## Reply Mode

Start with server replies as plain WireGuard because the provider handshake response was plain:

```text
02 00 00 00 ...
```

Keep an optional wrapped reply mode for testing networks that inspect return traffic more aggressively.

## Client UX

The stock WireGuard app points to the local wrapper:

```ini
Endpoint = 127.0.0.1:51821
```

The wrapper points to the real server:

```text
SERVER_IP:9091
```

Because the WireGuard app does not know the real server IP, full-tunnel configs need a host route exception so wrapper traffic does not loop into the VPN tunnel.

## Server UX

The public internet sees only the wrapper:

```text
UDP/9091
```

The real stock WireGuard port remains local/private:

```text
127.0.0.1:51820
```

## Validation

1. Unit-test packet wrapping/unwrapping.
2. Verify CLI parsing and startup.
3. Capture traffic with Wireshark or tcpdump.
4. Confirm client-to-server public UDP payload starts with:

```text
00 00 00 00 94 00 01 00 00 00
```

5. Confirm `sudo wg show` reports a recent handshake.

## Phase 2: Harden If Prototype Works

After the prototype works from the target network:

1. Add launchd and systemd templates.
2. Add route-helper commands for macOS.
3. Add stricter server multi-client mapping if multiple peers are needed.
4. Add configurable prefix, padding, and random padding.
5. Consider patching the macOS WireGuard app so the wrapper becomes internal and users do not need a separate daemon.

## Phase 3: Native Client If Needed

Patch WireGuard only after the external wrapper proves useful.

The native app would wrap packets inside the WireGuard backend and preserve normal endpoint routing. This avoids the local `127.0.0.1` endpoint and manual route exception, but it is more complex to maintain and sign on macOS.
