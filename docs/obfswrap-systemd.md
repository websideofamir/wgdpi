# Obfswrap Systemd Deployment Profile

This file records how to deploy the standalone `obfswrap/` encrypted wrapper on a server and a Linux client using systemd services.

`obfswrap` is separate from the older `wgwrap` implementation. It does not use prefix or padding.

Public packet format:

```text
[key_id:3] [nonce:12] [ciphertext] [tag:8]
```

Encrypted plaintext:

```text
[version:1] [inner_length:2] [raw_wireguard_packet]
```

## Status

Testing target:

- Stock WireGuard remains unchanged on both sides.
- Server exposes only the obfswrap public UDP port.
- Client WireGuard points to a local obfswrap endpoint.
- Server and client use the same deterministic secret source.
- No public prefix is used.
- No wrapper padding is used.

This is a new profile and should be tested first with split tunnel before full tunnel.

## Shared Secret Settings

Do not store real seeds in this document.

Use the same values on server and client:

```text
OBFS_SEED_HEX=REPLACE_WITH_32_BYTE_HEX_SEED
OBFS_SALT=REPLACE_WITH_DEPLOYMENT_SALT
OBFS_KEY_ID=999999
```

`OBFS_SEED_HEX` must be 64 hex characters, representing 32 random bytes.

Generate a seed with:

```bash
openssl rand -hex 32
```

The salt is a deployment/profile label. Example only:

```text
iran-home-v1
```

The same `OBFS_SEED_HEX`, `OBFS_SALT`, and `OBFS_KEY_ID` independently produce the same selected secret on both sides.

For `OBFS_KEY_ID=999999`, the first 3 public bytes are:

```text
0f423f
```

## Install Code

On both server and Linux client, clone or update the repository:

```bash
sudo install -d -m 755 /opt/wgdpi
sudo chown -R "$USER:$USER" /opt/wgdpi
git clone GITHUB_REPO_URL /opt/wgdpi
```

If already cloned:

```bash
cd /opt/wgdpi
git pull
```

Verify Node.js and the standalone CLI:

```bash
node -v
node /opt/wgdpi/obfswrap/bin/obfswrap.js --help
```

Expected help includes:

```text
[key_id:3] [nonce:12] [ciphertext] [tag:8]
```

## Server Secret Environment

Create a root-readable environment file:

```bash
sudo install -d -m 700 /etc/wgdpi
sudo nano /etc/wgdpi/obfswrap.env
```

Use:

```ini
OBFS_SEED_HEX=REPLACE_WITH_32_BYTE_HEX_SEED
OBFS_SALT=REPLACE_WITH_DEPLOYMENT_SALT
```

Protect it:

```bash
sudo chmod 600 /etc/wgdpi/obfswrap.env
sudo chown root:root /etc/wgdpi/obfswrap.env
```

## Server Wrapper

`/etc/systemd/system/obfswrap.service` should use:

```ini
[Unit]
Description=Obfswrap encrypted WireGuard UDP wrapper
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/wgdpi
EnvironmentFile=/etc/wgdpi/obfswrap.env
ExecStart=/usr/bin/node /opt/wgdpi/obfswrap/bin/obfswrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --seed-hex ${OBFS_SEED_HEX} --salt ${OBFS_SALT} --log-interval-ms 10000
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
```

Apply service changes with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now obfswrap.service
sudo systemctl status obfswrap.service --no-pager -l
```

Expected startup log includes:

```text
obfs server listening on 0.0.0.0:9091, forwarding to WireGuard at 127.0.0.1:51820
nonce=12, tag=8, padding=none, prefix=none
```

View logs with:

```bash
journalctl -u obfswrap.service -f
```

## Client Secret Environment

On the Linux client, create:

```bash
sudo install -d -m 700 /etc/wgdpi
sudo nano /etc/wgdpi/obfswrap.env
```

Use the same seed and salt as the server, plus the selected key ID:

```ini
OBFS_SEED_HEX=REPLACE_WITH_32_BYTE_HEX_SEED
OBFS_SALT=REPLACE_WITH_DEPLOYMENT_SALT
OBFS_KEY_ID=999999
OBFS_SERVER=YOUR_SERVER_IP
```

Protect it:

```bash
sudo chmod 600 /etc/wgdpi/obfswrap.env
sudo chown root:root /etc/wgdpi/obfswrap.env
```

## Client Wrapper

`/etc/systemd/system/obfswrap-client.service` should use:

```ini
[Unit]
Description=Obfswrap encrypted WireGuard client wrapper
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/wgdpi
EnvironmentFile=/etc/wgdpi/obfswrap.env
ExecStart=/usr/bin/node /opt/wgdpi/obfswrap/bin/obfswrap.js client --listen 127.0.0.1:51821 --remote ${OBFS_SERVER}:9091 --seed-hex ${OBFS_SEED_HEX} --salt ${OBFS_SALT} --key-id ${OBFS_KEY_ID} --log-interval-ms 10000
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
```

Apply service changes with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now obfswrap-client.service
sudo systemctl status obfswrap-client.service --no-pager -l
```

Expected startup log includes:

```text
obfs client listening on 127.0.0.1:51821
key_id=999999, nonce=12, tag=8, padding=none, prefix=none
```

View logs with:

```bash
journalctl -u obfswrap-client.service -f
```

## WireGuard Client Config

Do not store private keys in this document.

Use these non-secret settings first for split tunnel testing:

```ini
[Interface]
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
AllowedIPs = 10.44.0.0/24
Endpoint = 127.0.0.1:51821
PersistentKeepalive = 25
```

After split tunnel is stable, full tunnel can use:

```ini
AllowedIPs = 0.0.0.0/0
```

Do not add IPv6 full tunnel until IPv6 routing and firewalling are explicitly handled.

## Linux Route Exception

For full tunnel, the real server IP must not route through the WireGuard tunnel.

Before enabling full tunnel, add a host route through the normal gateway:

```bash
GATEWAY=$(ip route show default | awk '/default/{print $3; exit}')
IFACE=$(ip route show default | awk '/default/{print $5; exit}')
sudo ip route replace YOUR_SERVER_IP via "$GATEWAY" dev "$IFACE"
ip route get YOUR_SERVER_IP
```

The route result should not show `wg0` for `YOUR_SERVER_IP`.

If the network changes, recreate the route with the current default gateway.

## Server Firewall / Forwarding

Expose only the obfswrap public UDP port:

```text
UDP/9091
```

Do not expose stock WireGuard `UDP/51820` publicly unless intentionally testing plain WireGuard.

IP forwarding must be enabled:

```bash
sysctl net.ipv4.ip_forward
```

Expected:

```text
net.ipv4.ip_forward = 1
```

NAT should use the real WAN interface, currently for example `eth0`:

```text
-A POSTROUTING -s 10.44.0.0/24 -o eth0 -j MASQUERADE
```

If a placeholder rule exists, remove it:

```bash
sudo iptables -t nat -D POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE
```

## MSS Clamping

MSS clamping should remain enabled while testing full tunnel:

```bash
sudo iptables -t mangle -C FORWARD -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || sudo iptables -t mangle -A FORWARD -i wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
sudo iptables -t mangle -C FORWARD -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || sudo iptables -t mangle -A FORWARD -o wg0 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

Verify with:

```bash
sudo iptables -t mangle -S FORWARD
```

## Validation

Start services in this order:

```bash
sudo systemctl restart wg-quick@wg0
sudo systemctl restart obfswrap.service
sudo systemctl restart obfswrap-client.service
```

Then connect the client WireGuard tunnel that points to:

```ini
Endpoint = 127.0.0.1:51821
```

Test split tunnel first:

```bash
ping 10.44.0.1
```

Expected:

```text
64 bytes from 10.44.0.1
```

Check server WireGuard:

```bash
sudo wg show
```

Expected:

```text
latest handshake: ...
transfer: increasing
```

For full tunnel after the route exception is installed:

```bash
ping 1.1.1.1
curl https://ifconfig.me
```

Expected `curl` result:

```text
YOUR_SERVER_PUBLIC_IP
```

## Capture For Debugging

Public obfswrap traffic on client or server:

```bash
sudo tcpdump -ni any udp port 9091
```

Expected public UDP payload has no fixed prefix and no visible WireGuard type. For `OBFS_KEY_ID=999999`, packets start with:

```text
0f423f
```

Then 12 nonce bytes, encrypted bytes, and an 8-byte tag.

Server local WireGuard traffic:

```bash
sudo tcpdump -ni lo udp port 51820
```

Expected local traffic still contains normal stock WireGuard packets, because obfswrap decrypts before forwarding to WireGuard.

## Known Limitation

This profile does not pad packets.

That reduces bandwidth use and avoids the previous `1510` downlink padding amplification, but packet sizes still leak traffic-size patterns.

This profile also does not hide:

- UDP usage.
- Server IP.
- Hosting provider / ASN.
- Long-lived flow timing.
- Traffic volume bursts.

## Rollback

If this profile is worse, stop the obfswrap services:

```bash
sudo systemctl stop obfswrap-client.service
sudo systemctl stop obfswrap.service
```

Restore the previous `wgwrap` server command from `docs/latest-working.md`:

```ini
ExecStart=/usr/bin/node /opt/wgdpi/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --pad-bytes zero --prefix 7a21c90e --reply-mode wrapped --log-interval-ms 10000
```

Then restart the old service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart wgwrap.service
```

On the client, point WireGuard back to the old local wrapper service or command that listens on:

```ini
Endpoint = 127.0.0.1:51821
```
