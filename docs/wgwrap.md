# WireGuard Wrapper Guide

This prototype tests the packet format observed in your provider capture while keeping stock WireGuard on both ends.

## Goal

The client sends stock WireGuard to a local UDP wrapper. The wrapper changes the public packet shape before it reaches the network:

```text
prefix + length + stock WireGuard packet + random padding
```

The server wrapper strips that envelope and forwards the original WireGuard packet to the local WireGuard server.

## Architecture

Client:

```text
WireGuard app -> 127.0.0.1:51821 -> wgwrap client -> SERVER_IP:9091
```

Server:

```text
public UDP/9091 -> wgwrap server -> 127.0.0.1:51820 -> stock WireGuard
```

By default, server-to-client replies are plain WireGuard, matching your capture where the server handshake response started with `02 00 00 00`.

## Current Limits

- IPv4 UDP only.
- This is a prototype, not a hardened daemon.
- It does not hide the destination IP or UDP usage.
- If the server IP, hosting ASN, or all UDP traffic is blocked, this will not fix that.
- The server wrapper has best-effort multi-client mapping, but start with one client while validating.

## Server Setup

Install Node.js 20 or newer on the server.

Install and configure stock WireGuard. The WireGuard interface can still listen on `51820`, but block public access to that port and expose only the wrapper port.

If you intentionally run without UFW or another host firewall, skip the UFW commands below. The wrapper will bind `UDP/9091` on the host, and stock WireGuard will bind `UDP/51820` on the host. Docker/Traefik can continue using TCP `80`, `443`, and `2222` because those ports do not overlap.

## Check Existing Firewalls

Run these before changing firewall rules:

```bash
sudo systemctl is-active ufw || true
sudo ufw status verbose || true
```

Check raw iptables rules:

```bash
sudo iptables -S
sudo iptables -t nat -S
```

Check nftables rules:

```bash
sudo nft list ruleset
```

Check firewalld:

```bash
sudo systemctl is-active firewalld || true
sudo firewall-cmd --state || true
```

Check cloud-init or provider firewall hints:

```bash
sudo ls /etc/netplan
sudo ls /etc/iptables || true
sudo ls /etc/iptables/rules.v4 || true
```

Check listeners and Docker-published ports:

```bash
sudo ss -lunpt
sudo ss -ltnp
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

The wrapper needs `UDP/9091` to be free on the host. Stock WireGuard needs `UDP/51820` to be free on the host. Your compose file publishes only TCP `80`, `443`, and `2222`, so it should not conflict.

If Docker is installed, Docker will add iptables/nftables rules for bridge networking and NAT. Do not flush iptables/nftables globally, because that can break Docker networking and Traefik routing.

On Oracle Ubuntu images, UFW can be disabled while iptables still rejects most inbound host traffic. A typical ruleset has:

```text
-A INPUT -p tcp --dport 22 -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-host-prohibited
-A FORWARD -j REJECT --reject-with icmp-host-prohibited
```

In that case, add narrow rules instead of disabling or flushing the firewall:

```bash
sudo iptables -I INPUT 1 -p udp --dport 9091 -j ACCEPT
sudo iptables -I INPUT 1 -i wg0 -j ACCEPT
sudo iptables -I FORWARD 1 -i wg0 -j ACCEPT
sudo iptables -I FORWARD 1 -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

These rules do not touch Docker's `DOCKER`, `DOCKER-FORWARD`, or `DOCKER-USER` chains.

For persistence, put the `wg0` and `9091` rules in `wg0.conf` `PostUp`/`PostDown`, shown below. Do not edit or remove Oracle `InstanceServices` rules.

## Docker Compose Coexistence

Your compose stack can keep running. This wrapper guide runs `wgwrap` and WireGuard directly on the host, outside Docker.

No compose changes are required if these are true:

- No service publishes `9091:9091/udp`.
- No service publishes `51820:51820/udp`.
- Traefik keeps TCP `80`, `443`, and `2222`.
- The wrapper runs on the host with `--listen 0.0.0.0:9091`.
- WireGuard runs on the host as `wg-quick@wg0`.

If you later add a Docker service using `network_mode: host` or publishing `9091/udp`, stop it or choose another wrapper port.

Example `/etc/wireguard/wg0.conf`:

```ini
[Interface]
Address = 10.44.0.1/24
ListenPort = 51820
PrivateKey = SERVER_PRIVATE_KEY

PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -I INPUT 1 -p udp --dport 9091 -j ACCEPT
PostUp = iptables -I INPUT 1 -i wg0 -j ACCEPT
PostUp = iptables -I FORWARD 1 -i wg0 -j ACCEPT
PostUp = iptables -I FORWARD 1 -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -s 10.44.0.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -D INPUT -p udp --dport 9091 -j ACCEPT
PostDown = iptables -D INPUT -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s 10.44.0.0/24 -o eth0 -j MASQUERADE

[Peer]
PublicKey = CLIENT_PUBLIC_KEY
AllowedIPs = 10.44.0.2/32
```

Start WireGuard:

```bash
sudo wg-quick up wg0
```

If you use UFW, open wrapper UDP port and keep the real WireGuard port private:

```bash
sudo ufw allow 9091/udp
sudo ufw deny 51820/udp
```

If UFW is disabled and you have no other host firewall, do not run those commands. Make sure your cloud firewall/security group allows `UDP/9091` inbound.

If UFW is disabled but iptables has a final `INPUT REJECT`, you still have a host firewall. Use the narrow iptables rules above.

If you want to run with no host firewall, verify UFW is inactive:

```bash
sudo systemctl is-active ufw || true
sudo ufw status verbose || true
```

Then rely on these exposure choices:

- Public wrapper: `0.0.0.0:9091/udp`.
- Stock WireGuard: `0.0.0.0:51820/udp`, but not opened in cloud firewall if your provider has one.
- Docker/Traefik: unchanged TCP `80`, `443`, and `2222`.

For stricter host-local WireGuard exposure, bind protection is not available directly in stock WireGuard config. Use cloud firewall/security group rules to expose only `UDP/9091`, or add targeted iptables rules later after the prototype works.

Run the server wrapper from this repo:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --reply-mode plain
```

For randomized public packet sizes and a deployment-specific prefix, use matching settings on the client and server:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-min 900 --pad-max 1280 --prefix 7a21c90e --reply-mode wrapped
```

For a quick server packet check:

```bash
sudo tcpdump -ni any udp port 9091 or udp port 51820
```

You should see public traffic on `9091` and local wrapper-to-WireGuard traffic on `51820`.

## Optional systemd Service

Create `/etc/systemd/system/wgwrap.service`:

```ini
[Unit]
Description=WireGuard UDP wrapper
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/wgwrap
ExecStart=/usr/bin/node /opt/wgwrap/bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1510 --reply-mode plain
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wgwrap.service
sudo systemctl status wgwrap.service
```

## macOS Client Setup

Run the client wrapper before connecting WireGuard:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-to 1510
```

Randomized profile example:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-min 900 --pad-max 1280 --prefix 7a21c90e
```

The same `--prefix`, `--pad-min`, and `--pad-max` values must be configured on both sides.

Use `--pad-bytes zero` when you need to reproduce the legacy zero-padding byte shape for comparison.

Configure the WireGuard macOS app to use the local wrapper as its endpoint:

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = SERVER_PUBLIC_KEY
Endpoint = 127.0.0.1:51821
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```

The real server IP is configured only in the wrapper command, not in the WireGuard app.

## macOS Route Exception

For full-tunnel configs, add a host route so wrapper traffic to `YOUR_SERVER_IP` does not enter the VPN tunnel after it connects.

Find your current gateway before connecting WireGuard:

```bash
route -n get default
```

Look for the `gateway:` line. Then add the route:

```bash
sudo route -n add -host YOUR_SERVER_IP YOUR_CURRENT_GATEWAY
```

If the route already exists, change it:

```bash
sudo route -n change -host YOUR_SERVER_IP YOUR_CURRENT_GATEWAY
```

Verify it:

```bash
route -n get YOUR_SERVER_IP
```

Remove it when done testing:

```bash
sudo route -n delete -host YOUR_SERVER_IP
```

If your network changes, recreate the route with the new gateway.

## Connection Order

1. Start WireGuard on the server.
2. Start `wgwrap` server on the VPS.
3. Start `wgwrap` client on macOS.
4. Add the macOS host route to `YOUR_SERVER_IP` through your normal gateway.
5. Connect the WireGuard macOS tunnel that points at `127.0.0.1:51821`.

## Verification

On macOS, capture the public packets:

```bash
sudo tcpdump -i en0 -n -s 0 host YOUR_SERVER_IP and udp port 9091 -w wgwrap-client.pcap
```

In Wireshark, the client-to-server UDP payload should start like:

```text
00 00 00 00 94 00 01 00 00 00
```

For a 148-byte handshake initiation, `94 00` is the little-endian length.

The server handshake response may still appear as normal WireGuard:

```text
02 00 00 00 ...
```

Check WireGuard status on the server:

```bash
sudo wg show
```

Look for a recent `latest handshake` for the client peer.

## Troubleshooting

If no packets reach the server wrapper:

```bash
sudo tcpdump -ni any udp port 9091
```

Check VPS firewall, cloud security groups, and whether UDP to the server IP is blocked.

If packets reach `9091` but WireGuard has no handshake:

```bash
sudo tcpdump -ni lo udp port 51820
sudo wg show
```

Check that the server wrapper points to `127.0.0.1:51820` and WireGuard is running.

If the tunnel connects then immediately stops passing traffic, re-check the macOS route exception:

```bash
route -n get YOUR_SERVER_IP
```

If `YOUR_SERVER_IP` routes through `utun`, the wrapper traffic is looping into the VPN.

If the provider works but this wrapper does not, test another VPS IP/provider. The block may be based on IP reputation or ASN rather than packet shape.
