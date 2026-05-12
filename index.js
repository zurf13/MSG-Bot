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
let reconnectDelay = 5000; // ms, doubles on each fail, caps at 5min
let shuttingDown = false;

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

  // Start MC bot only after Discord is ready
  createMinecraftBot();
});

discord.on('messageCreate', (msg) => {
  if (msg.author.bot) return;
  if (msg.channelId !== DISCORD_CHANNEL) return;
  if (!bot || !bot.player) return;

  const text = `[Discord] ${msg.author.username}: ${msg.content}`.slice(0, 256);
  try {
    bot.chat(text);
  } catch (err) {
    console.log('[mc] chat send failed:', err.message);
  }
});

function sendDiscordMessage(content) {
  if (!discordChannel) {
    console.log('[discord] no channel bound, skipping:', content?.slice(0, 80));
    return;
  }
  discordChannel
    .send(content)
    .catch((err) => console.log('[discord] send failed:', err.message));
}

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
    reconnectDelay = 5000; // reset backoff
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    sendDiscordMessage(`**${username}:** ${message}`);
  });

  bot.on('whisper', (username, message) => {
    sendDiscordMessage(`📩 **${username} → you:** ${message}`);
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
    reconnectDelay = Math.min(reconnectDelay * 2, 300_000); // cap 5 min
  });
}

// ---------- Graceful shutdown ----------
function shutdown(signal) {
  console.log(`[sys] received ${signal}, shutting down`);
  shuttingDown = true;
  try {
    bot?.quit?.('shutdown');
  } catch {}
  try {
    discord.destroy();
  } catch {}
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
