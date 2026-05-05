# Server Setup

This guide configures an Ubuntu server to run stock WireGuard behind the `wgdpi` UDP wrapper.

The recommended first-test profile is:

```text
Wrapper public port: 9091/udp
Stock WireGuard port: 51820/udp
VPN subnet: 10.44.0.0/24
Server VPN IP: 10.44.0.1
Client VPN IP: 10.44.0.2
Wrapper mode: --reply-mode wrapped
Padding: --pad-to 1510
Prefix: default 00000000
```

Replace placeholders:

```text
YOUR_SERVER_IP
SERVER_PRIVATE_KEY
CLIENT_PUBLIC_KEY
WAN_IF
```

## Install Dependencies

Install WireGuard and basic tools:

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

Do not install Ubuntu's separate `npm` package unless you specifically need it for development. The wrapper runtime only needs `node`.

Verify:

```bash
node -v
wg --version
```

## Clone Project

Clone the repository to `/opt/wgdpi`:

```bash
cd /opt
sudo git clone GITHUB_REPO_URL wgdpi
sudo chown -R ubuntu:ubuntu /opt/wgdpi
cd /opt/wgdpi
node bin/wgwrap.js --help
```

If the repository already exists:

```bash
cd /opt/wgdpi
git pull
node bin/wgwrap.js --help
```

Expected output starts with:

```text
Usage:
  wgwrap client ...
  wgwrap server ...
```

## Check Existing Firewall State

UFW may be disabled while iptables still blocks inbound traffic. Check before changing rules:

```bash
sudo systemctl is-active ufw || true
sudo ufw status verbose || true
sudo iptables -S
sudo iptables -t nat -S
sudo nft list ruleset
```

Check listeners and Docker-published ports:

```bash
sudo ss -lunp
sudo ss -ltnp
docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null || true
```

The wrapper needs `UDP/9091` free. WireGuard needs `UDP/51820` free.

If Docker is running, do not flush iptables or nftables. Docker uses firewall/NAT rules for bridge networking.

## Cloud Firewall

If the server is on Oracle Cloud or another VPS provider with cloud firewall/security groups, allow inbound:

```text
UDP/9091 from 0.0.0.0/0
```

Keep existing rules for SSH and existing services. Do not expose `UDP/51820` unless you intentionally want to test plain WireGuard.

## Find Public Interface

Run:

```bash
ip route get 1.1.1.1
```

Example:

```text
1.1.1.1 via 10.0.0.1 dev enp0s6 src 10.0.0.54
```

In this example:

```text
WAN_IF=enp0s6
```

Use your actual interface name in the WireGuard config.

## Generate Server Keys

```bash
sudo install -d -m 700 /etc/wireguard
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
```

Show the server public key:

```bash
sudo cat /etc/wireguard/server.pub
```

Use that value on the client as `SERVER_PUBLIC_KEY`.

Show the server private key for config creation:

```bash
sudo cat /etc/wireguard/server.key
```

Use that value in `/etc/wireguard/wg0.conf` as `SERVER_PRIVATE_KEY`.

## Create WireGuard Config

Create `/etc/wireguard/wg0.conf`:

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
PostUp = iptables -C INPUT -i %i -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i %i -j ACCEPT
PostUp = iptables -C FORWARD -i %i -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i %i -j ACCEPT
PostUp = iptables -C FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp = iptables -t nat -C POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE

PostDown = iptables -D INPUT -p udp --dport 9091 -j ACCEPT 2>/dev/null || true
PostDown = iptables -D INPUT -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = CLIENT_PUBLIC_KEY
AllowedIPs = 10.44.0.2/32
```

Enable forwarding permanently:

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
sudo systemctl status wg-quick@wg0 --no-pager
```

If `wg-quick` fails with `iptables: Index of insertion too big`, your `INPUT` chain has fewer rules than the template expected. Replace any remaining `iptables -I INPUT 5` entries in `/etc/wireguard/wg0.conf` with `iptables -I INPUT 1`, then restart `wg-quick@wg0`.

Verify:

```bash
ip addr show wg0
sudo wg show
```

Expected interface address:

```text
10.44.0.1/24
```

## Verify Firewall Rules

```bash
sudo iptables -S INPUT
sudo iptables -S FORWARD
sudo iptables -t nat -S POSTROUTING
```

Required rules:

```text
-A INPUT -i wg0 -j ACCEPT
-A INPUT -p udp -m udp --dport 9091 -j ACCEPT
-A FORWARD -i wg0 -j ACCEPT
-A FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A POSTROUTING -s 10.44.0.0/24 -o WAN_IF -j MASQUERADE
```

## Run Server Wrapper Manually

Use this first because it is the known-good baseline:

```bash
cd /opt/wgdpi
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --reply-mode wrapped
```

Expected:

```text
server wrapper listening on 0.0.0.0:9091, forwarding to WireGuard at 127.0.0.1:51820, reply mode wrapped, fixed padding length 1510, prefix 0x00000000
```

After the baseline works, you can switch to randomized padding and a deployment-specific prefix. The client must use the same `--pad-min`, `--pad-max`, and `--prefix` values:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-min 900 --pad-max 1280 --prefix 7a21c90e --reply-mode wrapped
```

The wrapper logs startup settings, the active client endpoint when it changes, first occurrences of dropped/error packets, and a traffic summary every 60 seconds. Use `--log-interval-ms 0` to disable periodic summaries.

## Capture For Debugging

Public wrapper traffic:

```bash
sudo tcpdump -ni any udp port 9091
```

Local WireGuard traffic:

```bash
sudo tcpdump -ni lo udp port 51820
```

Expected with `--reply-mode wrapped`:

```text
any/9091: client -> server UDP length 1510
any/9091: server -> client UDP length 1510
lo/51820: 127.0.0.1.X -> 127.0.0.1.51820 UDP length 148
lo/51820: 127.0.0.1.51820 -> 127.0.0.1.X UDP length 92
```

With `--pad-min 900 --pad-max 1280`, public `9091` UDP lengths should vary within that range unless the inner WireGuard packet is larger than the selected target.

## systemd Service

After manual testing works, create `/etc/systemd/system/wgwrap.service`:

```bash
sudo nano /etc/systemd/system/wgwrap.service
```

Use `/opt/wgdpi` if that is where the repo is cloned:

```ini
[Unit]
Description=WireGuard UDP wrapper
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/wgdpi
ExecStart=/usr/bin/node /opt/wgdpi/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --reply-mode wrapped
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
```

Check the Node path:

```bash
which node
```

If it is not `/usr/bin/node`, update `ExecStart`.

Start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wgwrap.service
sudo systemctl status wgwrap.service --no-pager
```

View logs:

```bash
journalctl -u wgwrap.service -f
```

If you use a randomized profile, update `ExecStart` to use the same settings as the client:

```ini
ExecStart=/usr/bin/node /opt/wgdpi/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-min 900 --pad-max 1280 --prefix 7a21c90e --reply-mode wrapped
```

Check service configuration:

```bash
sudo systemctl cat wgwrap.service
```

## Update Deployment

When code changes are pushed to GitHub:

```bash
cd /opt/wgdpi
git pull
sudo systemctl restart wgwrap.service
sudo systemctl status wgwrap.service --no-pager
```

## Docker/Traefik Coexistence

The wrapper runs on the host and uses `UDP/9091`. Traefik commonly uses TCP `80`, `443`, and `2222`, so there is no conflict.

Do not publish `9091/udp` or `51820/udp` from Docker unless you intentionally move the wrapper/WireGuard into Docker.

Do not flush iptables/nftables globally. That can break Docker networking.

## Server Troubleshooting

Check listeners:

```bash
sudo ss -lunp | grep -E ':(9091|51820)\b'
```

Check WireGuard:

```bash
sudo wg show
ip addr show wg0
```

Check wrapper logs:

```bash
journalctl -u wgwrap.service -n 100 --no-pager
```

If no public packets arrive on `9091`, check cloud firewall/security group and the server `INPUT` rule.

If packets arrive on `9091` but not `lo:51820`, check the wrapper service and `--wireguard 127.0.0.1:51820`.

If packets reach `lo:51820` but no handshake occurs, check WireGuard keys and `AllowedIPs`.

If split tunnel works but full tunnel has no internet, check IP forwarding, `FORWARD` rules, and NAT.
