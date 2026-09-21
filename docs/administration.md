# Administration

## Indexers

Requests only download something if Prowlarr has at least one indexer. The first-run checklist on the Home page tells you when it has none. Settings > Indexers lists what you have (with a test button), and lets you add any public indexer in one click. Indexers that need an account are added in Prowlarr itself so you can enter your own login. Choose only sources you are entitled to use.

## Requests from other people

Settings > Server > Requests from other people:

- **Approval.** Requests from regular accounts wait for an administrator. Administrators see Approve and Decline on the Requests page and get a notification; the requester is told the outcome.
- **Limit.** Each regular account may make a number of requests per day or per week. Administrators are never limited.

## Notifications

The bell in the top bar shows what happened to your requests (administrators also see approvals, new accounts and backup problems). Settings > Notifications adds:

- **Desktop notifications** for this device, while a tab is open.
- **Channels:** Discord, Slack, Telegram, ntfy, Gotify, a generic JSON webhook, and email over SMTP. Each channel chooses which events it wants, and has a Send test button. Channel details are only visible to administrators.

## Backup and restore

Settings > Backup and restore. A backup is one `.tar.gz` with accounts, watch history, My Lists, requests, settings and custom themes. It does not include your media, and it leaves out sessions, so everyone signs in again after a restore. A backup runs automatically every day (the last 7 are kept), and you can make one whenever you like, download it, or restore one from this machine or from a file. Restoring makes a safety copy first, replaces the data and restarts the server (Docker and Podman bring it back because the app has `restart: unless-stopped`).

Backups live in `backups/` inside the data folder. Copy them somewhere else; a backup on the same disk does not protect you from that disk.

## Locked out?

From the folder you run the app in (or inside the container):

```bash
npm run admin -- users
npm run admin -- reset-password <username>          # prints a new password
npm run admin -- reset-password <username> <password>
npm run admin -- make-admin <username>
npm run admin -- create-admin <username> <password>
```

With Docker: `docker compose exec app npm run admin -- reset-password <username>`. The person is signed out everywhere.

## Skipping intros

If a file has chapters named like "Intro", "Opening", "Recap" or "Credits", the player shows a Skip button while that chapter plays (Skip credits goes to the next episode). Files without chapters get a "Skip 90 s" button in the first five minutes of an episode. Chapters are marked on the seek bar.
