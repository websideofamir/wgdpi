# Obfswrap Ubuntu Server And macOS Client Profile

This file records how to deploy the standalone `obfswrap/` encrypted wrapper with an Ubuntu server systemd service and a manually started macOS client wrapper.

`obfswrap` is separate from the older `wgwrap` implementation. It does not use a public prefix. This profile pads every public UDP payload to `1510` bytes to preserve the packet-size behavior that worked before.

Public packet format:

```text
[key_id:3] [nonce:12] [ciphertext] [tag:8]
```

Encrypted plaintext:

```text
[version:1] [inner_length:2] [raw_wireguard_packet] [encrypted_random_padding]
```

## Status

Testing target:

- Stock WireGuard remains unchanged on both sides.
- Server exposes only the obfswrap public UDP port.
- Client WireGuard points to a local obfswrap endpoint.
- Server and client use the same deterministic secret source.
- No public prefix is used.
- Every obfswrap packet is padded to public UDP payload length `1510` unless the inner packet is already larger.

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

## Secret Generation / Selection

The recommended mode is automatic deterministic derivation, not a stored generated list.

In this mode there is no `--count` option during normal client/server runtime. The server can derive any of the `16777216` possible 3-byte `key_id` secrets on demand:

```text
secret[key_id] = HMAC-SHA256(seed, "obfswrap-secret-v1" || 00 || salt || 00 || key_id_3_bytes)
```

The client sticks to the configured key ID until you change it:

```text
OBFS_KEY_ID=999999
```

That means every client packet starts with this 3-byte selector:

```text
0f423f
```

Then the server derives the matching secret for `key_id=999999` from the same seed and salt.

To rotate the selected secret, change `OBFS_KEY_ID` on the client and restart the client wrapper. The server does not need a matching config change when using `--seed-hex` and `--salt`, because it derives whichever `key_id` arrives in the packet.

If you want to pre-generate an actual secrets file, then you choose the amount with `--count`:

```bash
node obfswrap/bin/generate-secrets.js \
  --seed-hex REPLACE_WITH_32_BYTE_HEX_SEED \
  --salt REPLACE_WITH_DEPLOYMENT_SALT \
  --count 1000000 \
  --out secrets.txt
```

With a file, valid client key IDs are limited by the number of lines in the file. For `--count 1000000`, valid key IDs are:

```text
0 through 999999
```

For this deployment profile, use automatic deterministic derivation unless there is a specific reason to store a large secrets file.

## Install Code On Ubuntu Server

Install WireGuard, Node.js, and basic tools:

```bash
sudo apt update
sudo apt install -y wireguard curl ca-certificates git
```

Install Node.js 20 if Node is missing or too old:

```bash
node -v
```

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

On the Ubuntu server, clone or update the repository:

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

## Find Server WAN Interface

Find the public/WAN interface used for outbound internet traffic:

```bash
ip route get 1.1.1.1
```

Example output:

```text
1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.54 uid 1000
```

In this example, the WAN interface is:

```text
WAN_IF=eth0
```

Convenience command:

```bash
WAN_IF=$(ip route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')
echo "$WAN_IF"
```

Use the printed value wherever the guide says `WAN_IF`.

## Server WireGuard Keys

Create the server WireGuard keypair:

```bash
sudo install -d -m 700 /etc/wireguard
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
```

Show the server public key. This goes into the macOS WireGuard peer config as `SERVER_PUBLIC_KEY`:

```bash
sudo cat /etc/wireguard/server.pub
```

Show the server private key for `/etc/wireguard/wg0.conf`:

```bash
sudo cat /etc/wireguard/server.key
```

Do not paste the server private key into docs or chat.

## macOS WireGuard Client Keys

Install the WireGuard app from the Mac App Store or from WireGuard's official macOS download.

Create a new tunnel in the WireGuard app. The app generates a client private key and public key.

Copy the client public key from the macOS WireGuard tunnel. This goes into the Ubuntu server `/etc/wireguard/wg0.conf` as `CLIENT_PUBLIC_KEY`.

Keep the client private key only in the macOS WireGuard app.

## Server WireGuard Config

Create `/etc/wireguard/wg0.conf` on the Ubuntu server:

```bash
sudo nano /etc/wireguard/wg0.conf
```

Use this template. Replace `SERVER_PRIVATE_KEY`, `CLIENT_PUBLIC_KEY`, and `WAN_IF`.

```ini
[Interface]
Address = 10.44.0.1/24
ListenPort = 51820
PrivateKey = SERVER_PRIVATE_KEY

PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -C INPUT -p udp --dport 9091 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport 9091 -j ACCEPT
PostUp = iptables -C INPUT ! -i lo -p udp --dport 51820 -j DROP 2>/dev/null || iptables -I INPUT 1 ! -i lo -p udp --dport 51820 -j DROP
PostUp = iptables -C INPUT -i %i -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i %i -j ACCEPT
PostUp = iptables -C FORWARD -i %i -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i %i -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp = iptables -t nat -C POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE

PostDown = iptables -D INPUT -p udp --dport 9091 -j ACCEPT 2>/dev/null || true
PostDown = iptables -D INPUT ! -i lo -p udp --dport 51820 -j DROP 2>/dev/null || true
PostDown = iptables -D INPUT -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = CLIENT_PUBLIC_KEY
AllowedIPs = 10.44.0.2/32
```

Important: replace the literal `WAN_IF` placeholder with the value discovered earlier, for example `eth0`.

Enable IPv4 forwarding permanently:

```bash
printf 'net.ipv4.ip_forward=1\n' | sudo tee /etc/sysctl.d/99-wireguard.conf
sudo sysctl --system
sysctl net.ipv4.ip_forward
```

Expected:

```text
net.ipv4.ip_forward = 1
```

Start WireGuard:

```bash
sudo systemctl enable wg-quick@wg0
sudo systemctl restart wg-quick@wg0
sudo systemctl status wg-quick@wg0 --no-pager -l
```

Verify:

```bash
ip addr show wg0
sudo wg show
```

Expected interface address:

```text
10.44.0.1/24
```

## Install Code On macOS Client

Install Node.js with Homebrew if needed:

```bash
brew install node
```

Clone or update the repository:

```bash
git clone GITHUB_REPO_URL ~/wgdpi
```

If already cloned:

```bash
cd ~/wgdpi
git pull
```

Verify:

```bash
node -v
node ~/wgdpi/obfswrap/bin/obfswrap.js --help
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
ExecStart=/usr/bin/node /opt/wgdpi/obfswrap/bin/obfswrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --seed-hex ${OBFS_SEED_HEX} --salt ${OBFS_SALT} --pad-to 1510 --log-interval-ms 10000
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
nonce=12, tag=8, fixed padding length 1510, prefix=none
```

View logs with:

```bash
journalctl -u obfswrap.service -f
```

## Client Secret Environment

On macOS, create a user-readable environment file:

```bash
mkdir -p ~/.config/wgdpi
nano ~/.config/wgdpi/obfswrap.env
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
chmod 600 ~/.config/wgdpi/obfswrap.env
```

## Client Wrapper

For macOS, run the client wrapper manually before connecting the WireGuard tunnel.

Load the environment values in your current shell:

```bash
set -a
. ~/.config/wgdpi/obfswrap.env
set +a
```

Run the client wrapper:

```bash
node ~/wgdpi/obfswrap/bin/obfswrap.js client \
  --listen 127.0.0.1:51821 \
  --remote "${OBFS_SERVER}:9091" \
  --seed-hex "${OBFS_SEED_HEX}" \
  --salt "${OBFS_SALT}" \
  --key-id "${OBFS_KEY_ID}" \
  --pad-to 1510 \
  --log-interval-ms 10000
```

Expected startup log includes:

```text
obfs client listening on 127.0.0.1:51821
key_id=999999, nonce=12, tag=8, fixed padding length 1510, prefix=none
```

Keep this terminal open while testing. Stop it with `Ctrl-C`.

## WireGuard Client Config

In the macOS WireGuard app, edit the tunnel config.

Do not store private keys in this document or chat.

Use the client private key generated by the macOS WireGuard app:

```ini
PrivateKey = CLIENT_PRIVATE_KEY
```

Use the server public key from:

```bash
sudo cat /etc/wireguard/server.pub
```

Use these non-secret settings first for split tunnel testing:

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = SERVER_PUBLIC_KEY
AllowedIPs = 10.44.0.0/24
Endpoint = 127.0.0.1:51821
PersistentKeepalive = 25
```

After split tunnel is stable, full tunnel can use:

```ini
AllowedIPs = 0.0.0.0/0
```

Do not add IPv6 full tunnel until IPv6 routing and firewalling are explicitly handled.

## macOS Route Exception

For full tunnel, the real server IP must not route through the WireGuard tunnel.

Before enabling full tunnel, add a host route through the normal gateway:

```bash
GATEWAY=$(route -n get default | awk '/gateway:/{print $2; exit}')
sudo route -n add -host YOUR_SERVER_IP "$GATEWAY" || sudo route -n change -host YOUR_SERVER_IP "$GATEWAY"
route -n get YOUR_SERVER_IP
```

The route result should not show a WireGuard `utun` interface for `YOUR_SERVER_IP`.

If the network changes, recreate the route with the current default gateway.

Remove the route with:

```bash
sudo route -n delete -host YOUR_SERVER_IP
```

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

Start services in this order.

On Ubuntu server:

```bash
sudo systemctl restart wg-quick@wg0
sudo systemctl restart obfswrap.service
```

On macOS client:

```bash
set -a
. ~/.config/wgdpi/obfswrap.env
set +a
node ~/wgdpi/obfswrap/bin/obfswrap.js client --listen 127.0.0.1:51821 --remote "${OBFS_SERVER}:9091" --seed-hex "${OBFS_SEED_HEX}" --salt "${OBFS_SALT}" --key-id "${OBFS_KEY_ID}" --pad-to 1510 --log-interval-ms 10000
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

Public obfswrap traffic on Ubuntu server:

```bash
sudo tcpdump -ni any udp port 9091
```

Public obfswrap traffic on macOS client:

```bash
sudo tcpdump -i pktap -n -s 0 "host YOUR_SERVER_IP and udp port 9091"
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

This profile pads every public obfswrap packet to `1510` bytes unless the inner packet is already larger.

That restores the packet-size behavior from the latest working profile, but it also restores the same high-volume downlink limitation: YouTube and speedtest can cause fragmentation, queue pressure, and ping drops under traffic surge.

This profile also does not hide:

- UDP usage.
- Server IP.
- Hosting provider / ASN.
- Long-lived flow timing.
- Traffic volume bursts.

## Rollback

If this profile is worse, stop the obfswrap server service:

```bash
sudo systemctl stop obfswrap.service
```

On macOS client, stop the manually running wrapper with `Ctrl-C`.

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
