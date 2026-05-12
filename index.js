Got it — clean. Every `/command` in Discord = forwarded to Minecraft. Nothing else. No bot controls.

## Full `index.js`

```js
// index.js — Minecraft <-> Discord bridge for DonutSMP
import 'dotenv/config';
import mineflayer from 'mineflayer';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

// ---------- Env ----------
const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL,
  MC_HOST = 'donutsmp.net',
  MC_PORT = '25565',
  MC_USERNAME,
  MC_VERSION = '1.21.4',
} = process.env;

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!DISCORD_CHANNEL) throw new Error('Missing DISCORD_CHANNEL');
if (!MC_USERNAME) throw new Error('Missing MC_USERNAME');

// ---------- State ----------
let bot = null;
let discordChannel = null;
let reconnectDelay = 5000;
let shuttingDown = false;

// ---------- Helpers ----------
function sendDiscordMessage(content) {
  if (!discordChannel) {
    console.log('[discord] no channel bound, skipping:', content?.slice(0, 80));
    return;
  }
  discordChannel
    .send(content)
    .catch((err) => console.log('[discord] send failed:', err.message));
}

// Send a slash command to MC using the proper packet (works on 1.19+ signed-chat servers)
function runMcCommand(command) {
  if (!bot?.player) return false;
  try {
    const clean = command.replace(/^\//, '').trim();
    if (!clean) return false;
    bot._client.write('chat_command', { command: clean });
    return true;
  } catch (err) {
    console.log('[mc] command send failed:', err.message);
    return false;
  }
}

// ---------- Discord ----------
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

discord.once('clientReady', async () => {
  console.log(`[discord] logged in as ${discord.user.tag}`);
  try {
    discordChannel = await discord.channels.fetch(DISCORD_CHANNEL);
    if (!discordChannel) {
      console.log('[discord] channel fetch returned null — check DISCORD_CHANNEL id');
    } else {
      console.log(`[discord] bound to channel #${discordChannel.name}`);
    }
  } catch (err) {
    console.log('[discord] failed to fetch channel:', err.message);
  }

  createMinecraftBot();
});

discord.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channelId !== DISCORD_CHANNEL) return;

  const content = msg.content.trim();
  if (!content) return;

  // ----- Slash command → forward to Minecraft -----
  if (content.startsWith('/')) {
    if (!bot?.player) return msg.reply('❌ Not connected to Minecraft.');
    const ok = runMcCommand(content);
    if (ok) {
      await msg.react('✅').catch(() => {});
    } else {
      msg.reply('❌ Failed to send command.');
    }
    return;
  }

  // ----- Everything else → MC chat -----
  if (!bot?.player) return;
  const text = `[Discord] ${msg.author.username}: ${content}`.slice(0, 256);
  try {
    bot.chat(text);
  } catch (err) {
    console.log('[mc] chat send failed:', err.message);
  }
});

// ---------- Minecraft ----------
function createMinecraftBot() {
  if (shuttingDown) return;

  console.log(`[mc] connecting to ${MC_HOST}:${MC_PORT} as ${MC_USERNAME}`);

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: Number(MC_PORT) || 25565,
    username: MC_USERNAME,
    auth: 'microsoft',
    version: MC_VERSION,
    disableChatSigning: true,
    checkTimeoutInterval: 60_000,
  });

  bot.once('spawn', () => {
    console.log('[mc] spawned in world');
    sendDiscordMessage('✅ Bot connected to DonutSMP');
    reconnectDelay = 5000;
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    sendDiscordMessage(`**${username}:** ${message}`);
  });

  bot.on('whisper', (username, message) => {
    sendDiscordMessage(`📩 **${username} → you:** ${message}`);
  });

  // Server system messages (replies to /spawn, /rtp, etc.)
  bot.on('messagestr', (message, position) => {
    if (position === 'system' || position === undefined) {
      const trimmed = message?.trim();
      if (trimmed && trimmed.length > 0 && trimmed.length < 500) {
        sendDiscordMessage(`📜 ${trimmed}`);
      }
    }
  });

  bot.on('kicked', (reason) => {
    console.log('[mc] kicked:', reason);
    const r = typeof reason === 'string' ? reason : JSON.stringify(reason);
    sendDiscordMessage(`⚠️ Kicked: \`${r.slice(0, 500)}\``);
  });

  bot.on('error', (err) => {
    console.log('[mc] error:', err.message);
  });

  bot.on('end', (reason) => {
    console.log('[mc] disconnected:', reason);
    if (shuttingDown) return;

    sendDiscordMessage(
      `🔌 Disconnected (${reason || 'unknown'}). Reconnecting in ${reconnectDelay / 1000}s...`
    );
    setTimeout(createMinecraftBot, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 300_000);
  });
}

// ---------- Graceful shutdown ----------
function shutdown(signal) {
  console.log(`[sys] received ${signal}, shutting down`);
  shuttingDown = true;
  try { bot?.quit?.('shutdown'); } catch {}
  try { discord.destroy(); } catch {}
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.log('[sys] unhandledRejection:', err));
process.on('uncaughtException', (err) => console.log('[sys] uncaughtException:', err));

// ---------- Boot ----------
discord.login(DISCORD_TOKEN).catch((err) => {
  console.log('[discord] login failed:', err.message);
  process.exit(1);
});
```

## How it works now

| Discord input | What happens |
|---|---|
| `/spawn` | MC bot runs `/spawn` |
| `/rtp east` | MC bot runs `/rtp east` |
| `/tpa Silk` | MC bot runs `/tpa Silk` |
| `/anything` | Forwarded to MC, server reply shown in Discord with `📜` |
| `hello world` | Sent as MC chat: `[Discord] You: hello world` |

That's it. No bot-side commands, no `//`, no `!`. Push and test with `/spawn`.
