# Cobweb Discord Bot

Cobweb is a Discord bot for a VTM V20 Malkavian-only feed: short anonymous fragments, delayed delivery, and an admin moderation queue before the words reach the channel.

## Features

- `/cobweb message:<text>` for Malkavian players and ST/admin roles.
- `/cobweb_st message:<text> category?:<type>` for ST/admin roles.
- Random scheduling within the next configured hour.
- Per-user cooldown, defaulting to one submission every 15 minutes.
- SQLite-backed queue that survives restarts.
- Private moderation-channel entries with Edit and Delete controls.
- Webhook publishing as `Cobweb`, with no submitter name and no mention pings.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `GUILD_CONFIGS`
   - optional `DATABASE_PATH` and `WORKER_INTERVAL_MS`

3. Register slash commands:

   ```bash
   npm run register-commands
   ```

4. Start the bot:

   ```bash
   npm run build
   npm start
   ```

## Discord Permissions

For the Cobweb feed channel:

- Allow only Malkavian and ST/admin roles to view the channel.
- Deny `Send Messages`, `Create Public Threads`, `Create Private Threads`, `Add Reactions`, and `Use External Emojis` for everyone except the bot as needed.
- Let the bot manage webhooks and send messages.

For the moderation channel:

- Allow only ST/admin roles and the bot to view it.
- This channel receives queued fragments with internal audit metadata and moderation controls.

Discord always displays some sender label. Cobweb uses a webhook named `Cobweb` so the feed never shows the player or ST who submitted the fragment.

## Configuration

`GUILD_CONFIGS` is a JSON array:

```json
[
  {
    "guildId": "123456789012345678",
    "cobwebChannelId": "123456789012345678",
    "moderationChannelId": "123456789012345678",
    "malkavianRoleIds": ["123456789012345678"],
    "stRoleIds": ["123456789012345678"],
    "maxLength": 180,
    "cooldownMinutes": 15,
    "delayWindowMinutes": 60,
    "webhookName": "Cobweb",
    "blockedTerms": ["Victor Temple"]
  }
]
```

`blockedTerms` is a light guardrail for character names. It rejects submissions containing configured terms before they enter the queue.

## Development

```bash
npm run dev
npm test
npm run build
```

`/read_cobweb` is intentionally not included in v1. The database keeps posted history so an ST-configurable insight mechanic can be added later.

