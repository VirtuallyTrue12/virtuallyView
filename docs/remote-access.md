# Reaching your server from outside your home

`http://<your public address>:3000` times out for a friend when nothing between them and your computer passes the connection on. Check these in order.

## 1. Is the server itself reachable?

On your own network open `http://<this computer's local address>:3000`. If that works, the server is fine and the problem is the network path. The bundled stack publishes the app on port 3000 for the whole network and keeps every other service (Radarr, Sonarr, Lidarr and the rest) on this computer only.

## 2. Easiest and safest: Tailscale or a similar private network

Nothing is opened to the internet. Install Tailscale on the server and on your friend's device, share the server with them, and they open `http://<the server's Tailscale name or 100.x address>:3000`. `tailscale serve --bg 3000` gives you HTTPS on the same name.

Check it works: on the server run `tailscale ip -4`, then from another device on the same tailnet open `http://<that address>:3000`. Sign-in cookies work over plain HTTP here because the traffic is already encrypted by Tailscale. To let a friend in, share the server machine with them from the Tailscale admin page, or add their device to your tailnet. Chromecast and DLNA casting still need a device on the same physical network as the TV; the Tailscale address is for phones, laptops and tablets.

To give the app an address that other devices should use for links (cast links, invites), set it under Settings > Server > Connect other devices to the Tailscale name or address.

## 3. Port forwarding on your router

1. Give the server a fixed local address (a DHCP reservation in the router).
2. Forward TCP port 3000 from the router's WAN side to that address and port 3000.
3. Allow the port in the server's firewall (`sudo ufw allow 3000/tcp`, or the firewalld equivalent).
4. Test from a phone on mobile data, not from your own Wi-Fi. Many routers cannot loop back to their own public address, so testing from inside proves nothing.

If it still times out, your provider may put your home behind carrier-grade NAT (the router's WAN address is not the address the internet sees, or it starts with 100.64 to 100.127). Then forwarding cannot work: use option 2 or a tunnel.

## 4. A tunnel

Cloudflare Tunnel or a similar service connects out from your computer, so no port is opened and CGNAT does not matter. Point it at `http://localhost:3000`.

## Before you expose it

- Plain HTTP sends passwords in the clear. Put HTTPS in front: [HTTPS](https.md).
- Keep sign-up closed (the default) and give people their own accounts.
- Use strong passwords for every account, and change the default keys of the bundled services if you publish any of their ports.
- The dashboard is rate limited, but it is not built to be a public website. Prefer a private network for people you know.
