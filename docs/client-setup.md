# Client Setup

This guide configures a macOS client with stock WireGuard plus the local `wgdpi` wrapper.

The client wrapper listens locally and forwards wrapped packets to the real server:

```text
WireGuard app -> 127.0.0.1:51821 -> wgdpi client -> YOUR_SERVER_IP:9091
```

The WireGuard app only sees a local endpoint:

```ini
Endpoint = 127.0.0.1:51821
```

Replace placeholders:

```text
YOUR_SERVER_IP
SERVER_PUBLIC_KEY
CLIENT_PRIVATE_KEY
YOUR_CURRENT_GATEWAY
```

## Install Dependencies

Install Node.js on macOS:

```bash
brew install node
```

Verify:

```bash
node -v
```

Clone or update the project:

```bash
git clone GITHUB_REPO_URL wgdpi
cd wgdpi
node bin/wgwrap.js --help
```

If already cloned:

```bash
cd /path/to/wgdpi
git pull
node bin/wgwrap.js --help
```

## Generate Client Keys

Use the WireGuard macOS app to create a tunnel and generate keys.

The client private key stays in the macOS WireGuard config:

```text
CLIENT_PRIVATE_KEY
```

The client public key goes on the server in `/etc/wireguard/wg0.conf`:

```text
CLIENT_PUBLIC_KEY
```

The server public key goes in the macOS WireGuard peer config:

```text
SERVER_PUBLIC_KEY
```

## Start Client Wrapper

Use the same `--pad-to` value as the server. Start with the known-good baseline:

```bash
cd /path/to/wgdpi
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-to 1510
```

Expected:

```text
client wrapper listening on 127.0.0.1:51821, forwarding to YOUR_SERVER_IP:9091
```

Keep this terminal open while testing.

## Split Tunnel Mode

Use split tunnel first. It only routes the VPN subnet through the tunnel and avoids route-loop problems.

WireGuard macOS config:

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = SERVER_PUBLIC_KEY
Endpoint = 127.0.0.1:51821
AllowedIPs = 10.44.0.0/24
PersistentKeepalive = 25
```

Connect the WireGuard tunnel.

Test:

```bash
ping 10.44.0.1
```

Expected:

```text
64 bytes from 10.44.0.1
```

Check server:

```bash
sudo wg show
```

Expected:

```text
latest handshake: ...
transfer: increasing
```

Do not continue to full tunnel until split tunnel is stable.

## Full Tunnel Mode

Full tunnel routes all IPv4 traffic through WireGuard.

Because WireGuard sees only the local endpoint `127.0.0.1:51821`, macOS does not automatically protect the real server IP from being routed into the VPN. Add a host route exception before connecting.

Disconnect WireGuard first.

Find your normal gateway:

```bash
route -n get default
```

Look for:

```text
gateway: YOUR_CURRENT_GATEWAY
```

Add or update the route exception:

```bash
sudo route -n add -host YOUR_SERVER_IP YOUR_CURRENT_GATEWAY
```

If the route already exists:

```bash
sudo route -n change -host YOUR_SERVER_IP YOUR_CURRENT_GATEWAY
```

Convenience command:

```bash
GATEWAY=$(route -n get default | awk '/gateway:/{print $2; exit}')
sudo route -n add -host YOUR_SERVER_IP "$GATEWAY" || sudo route -n change -host YOUR_SERVER_IP "$GATEWAY"
route -n get YOUR_SERVER_IP
```

Verify that `YOUR_SERVER_IP` does not route through a WireGuard `utun` interface.

Good:

```text
interface: en0
gateway: YOUR_CURRENT_GATEWAY
```

Bad:

```text
interface: utun...
```

Full tunnel WireGuard config:

```ini
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.44.0.2/32
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = SERVER_PUBLIC_KEY
Endpoint = 127.0.0.1:51821
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

Do not add `::/0` until IPv6 support is explicitly handled.

Connect WireGuard.

Test:

```bash
ping 10.44.0.1
ping 1.1.1.1
curl https://ifconfig.me
```

Expected `curl` result:

```text
YOUR_SERVER_PUBLIC_IP
```

## Revert macOS Route Exception

To remove the host route:

```bash
sudo route -n delete -host YOUR_SERVER_IP
```

If macOS says the route is not in table, that is fine.

Verify:

```bash
route -n get YOUR_SERVER_IP
```

## Alternative Stability Profile

If the `1510/1280/25` baseline connects but is unstable, try a smaller non-fragmenting profile.

Server wrapper:

```bash
node bin/wgwrap.js server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 --pad-to 1280 --reply-mode wrapped
```

Client wrapper:

```bash
node bin/wgwrap.js client --listen 127.0.0.1:51821 --remote YOUR_SERVER_IP:9091 --pad-to 1280
```

WireGuard config changes:

```ini
MTU = 1180
PersistentKeepalive = 10
```

Test split tunnel for several minutes before trying full tunnel.

## Client Debugging

macOS public capture:

```bash
sudo tcpdump -i pktap -n -s 0 "host YOUR_SERVER_IP and udp port 9091"
```

macOS local wrapper capture:

```bash
sudo tcpdump -i lo0 -n -s 0 "udp port 51821"
```

Expected public traffic with wrapped replies:

```text
mac -> server UDP length 1510
server -> mac UDP length 1510
```

Expected local traffic:

```text
WireGuard app -> wrapper UDP length 148
wrapper -> WireGuard app UDP length 92
```

If macOS sees public replies but WireGuard logs never show `Received handshake response`, check the client wrapper and loopback capture.

If WireGuard logs show `Received handshake response` but ping fails, check server `wg0` address, server peer `AllowedIPs`, and server `INPUT -i wg0` rule.

If split tunnel works but full tunnel fails, check the route exception:

```bash
route -n get YOUR_SERVER_IP
```

The real server IP must not route through `utun`.
