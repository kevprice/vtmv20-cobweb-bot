# Cobweb Discord Bot

Cobweb is a Discord bot for a VTM V20 Malkavian-only feed: short anonymous fragments, delayed delivery, and an admin moderation queue before the words reach the channel.

## Features

- `/cobweb message:<text>` for Malkavian players and ST/admin roles.
- `/cobweb_st message:<text> delay-minutes?:<number>` for ST/admin roles.
- Random scheduling within the next configured hour.
- Player per-user cooldown, defaulting to one submission every 15 minutes.
- ST/admin posts bypass cooldown and can post immediately or after a chosen delay.
- SQLite-backed queue that survives restarts.
- Private moderation-channel entries with Edit and Delete controls.
- Webhook publishing as `Cobweb`, with no submitter name and no mention pings.
- Discord-native `/cwsetup` commands for per-server configuration stored in SQLite.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - optional `DATABASE_URL` and `WORKER_INTERVAL_MS`

3. Register slash commands:

   ```bash
   npm run register-commands
   ```

4. Start the bot:

   ```bash
   npm run build
   npm start
   ```

5. In each Discord server, a user with `Manage Server` or `Administrator` runs:

   ```text
   /cwsetup cobweb-channel channel:#cobweb
   /cwsetup moderation-channel channel:#cobweb-mod
   /cwsetup malkavian-role role:@Malkavian
   /cwsetup st-role role:@Storyteller
   /cwsetup max-length characters:180
   /cwsetup cooldown minutes:15
   /cwsetup delay-window minutes:60
   /cwsetup blocked-term add term:"Victor Temple"
   /cwsetup show
   ```

## Discord Permissions

For the Cobweb feed channel:

- Allow only Malkavian and ST/admin roles to view the channel.
- Deny `Send Messages`, `Create Public Threads`, `Create Private Threads`, `Add Reactions`, and `Use External Emojis` for everyone except the bot as needed.
- Let the bot `Manage Webhooks` and `Send Messages`.

For the moderation channel:

- Allow only ST/admin roles and the bot to view it.
- This channel receives queued fragments with internal audit metadata and moderation controls.

Discord always displays some sender label. Cobweb uses a webhook named `Cobweb` so the feed never shows the player or ST who submitted the fragment.
If queued fragments change to `FAILED` at publish time, first verify the bot has `Manage Webhooks` in the configured Cobweb channel and that the channel still exists.
`/cwsetup show` reports Cobweb and moderation channel permission health, including missing `Manage Webhooks`, `Send Messages`, `View Channel`, or `Read Message History`.

ST/admin submissions are not slow-posted unless the ST chooses a delay with `delay-minutes`. Omitting `delay-minutes` or setting it to `0` queues the fragment for immediate publish after the moderation entry is created.

## Configuration

Environment variables are only for secrets and global runtime settings:

```env
DISCORD_TOKEN=replace-with-bot-token
DISCORD_CLIENT_ID=replace-with-application-client-id
DATABASE_URL=./data/cobweb.db
WORKER_INTERVAL_MS=30000
```

`DATABASE_URL` is currently a SQLite file path or `file:` URL, not a Postgres connection URL.

Per-server configuration is stored in SQLite, keyed by `guildId`, and managed with `/cwsetup`.
The database stores channel IDs, role IDs, limits, cooldowns, delay windows, webhook credentials, and blocked terms.

`/cwsetup blocked-term add` is a light guardrail for character names. It rejects submissions containing configured terms before they enter the queue.

## Development

```bash
npm run dev
npm test
npm run build
```

## Railway Deployment

This bot is Railway-ready through `railway.json` and `nixpacks.toml`.

1. Create a new Railway service from this repository.
2. Add a Railway Volume for persistent SQLite storage.
3. Mount the volume somewhere like `/data`.
4. Set Railway variables:

   ```env
   DISCORD_TOKEN=replace-with-bot-token
   DISCORD_CLIENT_ID=replace-with-application-client-id
   DATABASE_URL=/data/cobweb.db
   WORKER_INTERVAL_MS=30000
   ```

5. Deploy the service.
6. Run the command registration once from Railway or locally with the same env:

   ```bash
   npm run register-commands
   ```

Railway provides `PORT` automatically. The bot starts a small `/healthz` endpoint on that port so Railway can health-check the worker while the Discord client runs in the same process.

Do not use Railway's Postgres `DATABASE_URL` for this version. The app currently stores its queue and server setup in SQLite, so use a mounted Volume path such as `/data/cobweb.db`.

`/read_cobweb` is intentionally not included in v1. The database keeps posted history so an ST-configurable insight mechanic can be added later.
