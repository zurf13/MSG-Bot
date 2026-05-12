```javascript
require('dotenv').config();
const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');

const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = Number(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
const MC_USERNAME = process.env.MC_USERNAME || 'DonutBot';
const AUTH_CACHE = process.env.AUTH_CACHE || './auth-cache';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

const hasDiscordBot = Boolean(DISCORD_TOKEN && DISCORD_CHANNEL_ID);
const hasWebhook = Boolean(DISCORD_WEBHOOK_URL);

if (!hasDiscordBot && !hasWebhook) {
  console.error('You must provide either DISCORD_TOKEN + DISCORD_CHANNEL_ID, or DISCORD_WEBHOOK_URL.');
  process.exit(1);
}

const discord = hasDiscordBot
  ? new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    })
  : null;

let discordChannel = null;
const webhookClient = hasWebhook ? new WebhookClient({ url: DISCORD_WEBHOOK_URL }) : null;
let mcBot;

function sendDiscordMessage(content) {
  if (webhookClient) {
    return webhookClient.send({ content }).catch((err) => console.error('Webhook send failed:', err));
  }
  if (discordChannel) {
    return discordChannel.send(content).catch((err) => console.error('Discord channel send failed:', err));
  }
  return Promise.resolve();
}

function createMinecraftBot() {
  const options = {
    host: MC_HOST,
    port: MC_PORT,
    version: MC_VERSION,
    username: MC_USERNAME,
    auth: 'microsoft',
    profilesFolder: AUTH_CACHE,
    onMsaCode: (data) => {
      const msg = `🔐 **Microsoft login required**\nGo to <${data.verification_uri}> and enter code: \`${data.user_code}\`\n(Expires in ${data.expires_in}s)`;
      console.log('\n' + msg + '\n');
      sendDiscordMessage(msg);
    },
  };

  mcBot = mineflayer.createBot(options);

  mcBot.once('spawn', () => {
    console.log(`Minecraft bot connected as ${mcBot.username}`);
    sendDiscordMessage(`✅ Minecraft bot connected as **${mcBot.username}**.`);
  });

  mcBot.on('chat', (username, message) => {
    if (username === mcBot.username) return;
    sendDiscordMessage(`**${username}**: ${message}`);
  });

  mcBot.on('message', (jsonMsg) => {
    sendDiscordMessage(`MC: ${jsonMsg.toString()}`);
  });

  mcBot.on('error', (err) => {
    console.error('Minecraft error:', err);
    sendDiscordMessage(`⚠️ Minecraft error: ${err.message}`);
  });

  mcBot.on('kicked', (reason) => {
    console.log('Kicked:', reason);
    sendDiscordMessage(`👢 Kicked: ${reason}`);
  });

  mcBot.on('end', () => {
    console.log('Minecraft bot disconnected. Reconnecting in 10s...');
    sendDiscordMessage('🔄 Disconnected. Reconnecting in 10s...');
    setTimeout(createMinecraftBot, 10000);
  });
}

if (discord) {
  discord.once('ready', async () => {
    console.log(`Discord bot logged in as ${discord.user.tag}`);
    try {
      discordChannel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
    } catch (err) {
      console.error('Failed to fetch Discord channel:', err);
    }
  });

  discord.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    if (msg.channelId !== DISCORD_CHANNEL_ID) return;
    if (!msg.content.startsWith(COMMAND_PREFIX)) return;
    if (!mcBot || !mcBot.player) {
      msg.reply('Minecraft bot is not connected yet.').catch(() => {});
      return;
    }
    const command = msg.content.slice(COMMAND_PREFIX.length);
    mcBot.chat(`/${command}`);
  });

  discord.login(DISCORD_TOKEN);
}

console.log('Starting Minecraft bot...');
createMinecraftBot();
```

## Quick deploy checklist

1. Replace your `index.js` with the above.
2. On Railway → **Variables**: remove `MC_EMAIL` / `MC_PASSWORD`. Keep `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_URL`.
3. On Railway → **Volumes**: add a volume mounted at `/app/auth-cache`.
4. **Rotate** the leaked Discord token, webhook, and Microsoft password.
5. Deploy → check logs (or Discord) for the login code → visit `microsoft.com/link` → enter code → done.

Token caches in the volume so future restarts skip the login step.
