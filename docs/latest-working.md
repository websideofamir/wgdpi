# Latest Working Profile

This file records the latest profile that is confirmed to work before testing the next stage.

## Status

Confirmed working:

- Split tunnel ping works.
- Full tunnel works.
- Web browsing works well after MSS clamping.
- YouTube and speedtest still cause ping drops / instability under high traffic.

This is the rollback point before testing plain server replies or more advanced padding behavior.

## Server Wrapper

`/etc/systemd/system/wgwrap.service` should use:

```ini
ExecStart=/usr/bin/node /opt/wgdpi/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --pad-bytes zero --prefix 7a21c90e --reply-mode wrapped --log-interval-ms 10000
```

Apply service changes with:

```bash
sudo systemctl daemon-reload
sudo systemctl restart wgwrap.service
sudo systemctl status wgwrap.service --no-pager -l
```

Expected startup log includes:

```text
reply mode wrapped, fixed padding length 1510, pad bytes zero, prefix 0x7a21c90e
```

## Client Wrapper

Run the client wrapper with:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote 65.109.215.61:9091 --pad-to 1510 --pad-bytes zero --prefix 7a21c90e --log-interval-ms 10000
```

Expected startup log includes:

```text
fixed padding length 1510, pad bytes zero, prefix 0x7a21c90e
```

## WireGuard Client Config

Do not store private keys in this document.

Use these non-secret settings:

```ini
[Interface]
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
AllowedIPs = 0.0.0.0/0
Endpoint = 127.0.0.1:51821
PersistentKeepalive = 25
```

For split tunnel rollback testing, use:

```ini
AllowedIPs = 10.44.0.0/24
```

## macOS Route Exception

For full tunnel, the real server IP must not route through the WireGuard tunnel.

```bash
GATEWAY=$(route -n get default | awk '/gateway:/{print $2; exit}')
sudo route -n add -host 65.109.215.61 "$GATEWAY" || sudo route -n change -host 65.109.215.61 "$GATEWAY"
route -n get 65.109.215.61
```

The route result should not show a `utun` interface for `65.109.215.61`.

## Server Firewall / Forwarding

IP forwarding must be enabled:

```bash
sysctl net.ipv4.ip_forward
```

Expected:

```text
net.ipv4.ip_forward = 1
```

NAT should use the real WAN interface, currently `eth0`:

```text
-A POSTROUTING -s 10.44.0.0/24 -o eth0 -j MASQUERADE
```

Remove the bad placeholder rule if present:

```bash
sudo iptables -t nat -D POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE
```

## MSS Clamping

MSS clamping improved web browsing stability and should remain enabled while testing full tunnel:

```bash
sudo iptables -t mangle -C FORWARD -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || sudo iptables -t mangle -A FORWARD -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
sudo iptables -t mangle -C FORWARD -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || sudo iptables -t mangle -A FORWARD -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

Verify with:

```bash
sudo iptables -t mangle -S FORWARD
```

## Known Limitation

This working profile wraps server replies too:

```text
--reply-mode wrapped
```

That means high-volume downlink traffic such as YouTube and speedtest is padded to large UDP packets on the return path. This likely causes fragmentation and queue pressure under traffic surge.

## Next Stages To Test

Test mixed server replies while keeping everything else the same:

```text
--reply-mode mixed
```

Mixed mode wraps handshake/control replies so the tunnel can establish on restrictive paths, then sends transport data replies plain to avoid padding amplification on high-volume downlink traffic.

If mixed mode handshakes but ping fails, test adaptive replies:

```text
--reply-mode adaptive
```

Adaptive mode keeps all server replies wrapped, but transport data replies are wrapped only with the 6-byte wrapper header and no fixed `1510` padding. This avoids plain WireGuard replies while reducing downlink padding amplification.

If unpadded adaptive replies do not complete the tunnel, test an intermediate transport reply target:

```text
--reply-mode adaptive --reply-transport-pad-to 1400
```

This keeps handshake/control replies at `1510`, but pads wrapped transport replies only to `1400`.

## Rollback

If the next stage is worse, restore this server wrapper command:

```ini
ExecStart=/usr/bin/node /opt/wgdpi/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --pad-bytes zero --prefix 7a21c90e --reply-mode wrapped --log-interval-ms 10000
```

Then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart wgwrap.service
```
