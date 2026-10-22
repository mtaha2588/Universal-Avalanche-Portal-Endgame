# Put the portal online for free (Oracle Cloud Always Free)

Result: a permanent public address such as `http://140.238.1.2/` (plus `https://140-238-1-2.sslip.io/`).
Anyone opens it in a browser. Nobody needs the project files, and your PC can be switched off.

Oracle's Always Free tier is a real Linux server that does not expire. It needs a credit or debit card
to verify identity, but Always Free resources are never charged.

---

## 1. Create the Oracle account (one time, about 15 minutes)

1. Go to https://www.oracle.com/cloud/free/ and click **Start for free**.
2. **Home Region**: pick one close to Pakistan, such as *UAE East (Dubai)*, *Saudi Arabia West (Jeddah)* or
   *India West (Mumbai)*. This cannot be changed later.
3. Finish the card verification. A small temporary hold may appear; it is released.

## 2. Create the server

Menu ☰ → **Compute → Instances → Create instance**.

| Setting | Choose |
|---|---|
| Name | `avalanche-portal` |
| Image | **Canonical Ubuntu 22.04** (or 24.04) |
| Shape | **Ampere → VM.Standard.A1.Flex**, 2 OCPU, 12 GB memory (Always Free). If it says *out of capacity*, use **VM.Standard.E2.1.Micro** instead; the installer adds swap for it. |
| Networking | *Create new virtual cloud network* + *public subnet*, **Assign a public IPv4 address: Yes** |
| SSH keys | **Generate a key pair for me** → **Save private key** (keep this file safe; it is the only way in) |

Click **Create**. When it shows *Running*, copy the **Public IP address** from the instance page.

## 3. Open the web ports in Oracle's firewall

On the instance page: **Primary VNIC → Subnet → Security → Default Security List → Add Ingress Rules**

- Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range **80,443** → **Add Ingress Rules**.

(Port 22 for SSH is already open. The installer opens the server's own firewall too.)

## 4. Deploy (one command from this PC)

Open PowerShell in the project folder and run, with your IP and key file:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Ip 140.238.1.2 -Key "C:\Users\PC\Downloads\ssh-key-2026-10-22.key"
```

It builds `dist\avalanche-portal.zip`, uploads it, installs Python, nginx and the portal as a service that
starts on boot and restarts if it crashes, opens the firewall, and requests a free HTTPS certificate.
The first run takes 3–5 minutes. At the end it prints the address to share:

- `http://<IP>/`
- `https://<IP-with-dashes>.sslip.io/` (recommended: HTTPS turns on the map tile cache, so maps load faster)

## 5. Mapbox key

If your Mapbox token has URL restrictions (account.mapbox.com → Tokens), add
`http://<IP>` and `https://<IP-with-dashes>.sslip.io`. If you skip this, the portal still works: it
automatically falls back to the free MapLibre / Esri map.

---

## Updating after changes

Edit the portal on this PC as usual, then run the same `deploy.ps1` command again. It replaces the code and
data on the server and restarts it. Python packages are reinstalled only if needed.

## Optional: require a password

Anyone who knows the address can open the portal. To require a login, connect to the server and create users:

```powershell
ssh -i "C:\path\to\key.key" ubuntu@<IP>
```
```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.portal_users ndma     # asks for a password; drop -c to add more users
sudo bash ~/setup_server.sh --https                # re-applies the nginx config with the login
```

To remove the login: `sudo rm /etc/nginx/.portal_users`, then run the last line again.

## Useful server commands (after `ssh -i key ubuntu@<IP>`)

| Task | Command |
|---|---|
| Live log | `sudo journalctl -u avalanche-portal -f` |
| Restart | `sudo systemctl restart avalanche-portal` |
| Status | `systemctl status avalanche-portal` |
| Edit settings (.env) | `sudo nano /opt/avalanche-portal/.env` then restart |

## Things to know

- **The IP stays the same** while the instance exists, including across reboots and stop/start. It only
  changes if you terminate the instance.
- **Idle reclaim:** Oracle may stop Always Free instances that sit almost idle (under 20 % CPU) for 7 days.
  To prevent that, upgrade the account to *Pay As You Go* (Billing → Upgrade). You still pay nothing while you
  stay within the Always Free limits.
- **Troubleshooting:** if the page does not open, check step 3 (ports 80/443) first. If it opens on the server
  but not outside, the Oracle security list is the cause.
- The zip contains `.env` (Mapbox token, secret key). Do not share `dist\avalanche-portal.zip`.
