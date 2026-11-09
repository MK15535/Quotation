# Quotation Management
Windows desktop app (Electron + vanilla HTML/CSS/JS). Installs with a normal Setup.exe built by GitHub Actions.

## Modes (chosen on first run, changeable from Settings)
- **Standalone** – data on this PC only.
- **Server** – this PC stores the database and serves it on the LAN (HTTP port 4747 + UDP discovery 4748).
- **Terminal** – connects to a server. Install the app on another PC → "Find server on network" discovers it automatically, or type its IP.

Allow the app in Windows Firewall (Private network) on the server PC. Terminals refresh shared data every ~8 s (last write wins).

## Accounts
First launch of a standalone/server creates the **admin** account. Admins add/remove users (roles: admin, user). Passwords are stored as scrypt hashes on the server.

## Build
Push to `main` → GitHub Actions → artifact **Quotation-Management-Setup**; push a tag `v1.0.0` to publish a Release.
Local: `npm install && npm start` / `npm run dist`.
