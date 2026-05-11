# MSG Bot

A Minecraft bot that connects to `donutsmp.net` and relays commands from a Discord channel into the server.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file or set environment variables:

- `DISCORD_TOKEN` - Discord bot token (required for command input)
- `DISCORD_CHANNEL_ID` - Channel ID where commands will be accepted (required for command input)
- `DISCORD_WEBHOOK_URL` - Optional webhook URL for posting Minecraft messages into Discord
- `MC_HOST` - Minecraft server host (default: `donutsmp.net`)
- `MC_PORT` - Minecraft server port (default: `25565`)
- `MC_VERSION` - Minecraft version (default: `1.21.11`)
- `MC_AUTH` - `microsoft` or `offline` (default: `microsoft`)
- `MC_EMAIL` - Microsoft account email (required for `microsoft` auth)
- `MC_PASSWORD` - Microsoft account password (required for `microsoft` auth)
- `MC_USERNAME` - Bot username for `offline` auth
- `COMMAND_PREFIX` - Command prefix for Discord messages (default: `/`)

3. Run the bot:

```bash
node index.js
```

## Usage

- Type `/spawn` in the configured Discord channel to execute `/spawn` on the Minecraft bot.
- Type `/tell <player> <message>` to send a private message.
- Any message starting with `/` will be relayed to the Minecraft server.
- Minecraft chat and server messages will be posted into Discord.

## Notes

- The bot forwards Minecraft chat and server messages into the Discord channel.
- If you are using a webhook, set `DISCORD_WEBHOOK_URL`; it will be used for output.
- If you want command input from the channel, you need both `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID`.
- Make sure your Discord bot has `Message Content Intent` enabled.
- `mineflayer` is compatible with Minecraft `1.21.11`.
