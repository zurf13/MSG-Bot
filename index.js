require('dotenv').config();
const fs = require('fs');
const mineflayer = require('mineflayer');
const {
  Client,
  GatewayIntentBits,
  WebhookClient,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

// ---------- Config ----------
const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = Number(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
const MC_USERNAME = process.env.MC_USERNAME || 'DonutBot';
const AUTH_CACHE = process.env.AUTH_CACHE || './auth-cache';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID; // optional, makes commands appear instantly in one server
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const hasDiscordBot = Boolean(DISCORD_TOKEN && DISCORD_CHANNEL_ID);
const hasWebhook = Boolean(DISCORD_WEBHOOK_URL);

if (!hasDiscordBot && !hasWebhook) {
  console.error('You must provide either DISCORD_TOKEN + DISCORD_CHANNEL_ID, or DISCORD_WEBHOOK_URL.');
  process.exit(1);
}

// ---------- Discord setup ----------
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

// ---------- State ----------
let mcBot = null;
let shouldReconnect = true;
let afkInterval = null;

// ---------- Helpers ----------
function sendDiscordMessage(content) {
  if (webhookClient) {
    return webhookClient.send({ content }).catch((err) => console.error('Webhook send failed:', err));
  }
  if (discordChannel) {
    return discordChannel.send(content).catch((err) => console.error('Discord channel send failed:', err));
  }
  return Promise.resolve();
}

function stopAfk() {
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }
}

// ---------- Minecraft bot ----------
function createMinecraftBot() {
  shouldReconnect = true;

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

  const bot = mineflayer.createBot(options);
  mcBot = bot;

  bot.once('spawn', () => {
    console.log(`✅ Minecraft bot connected as ${bot.username}`);
    sendDiscordMessage(`✅ Minecraft bot connected as **${bot.username}**.`);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    sendDiscordMessage(`**${username}**: ${message}`);
  });

  bot.on('message', (jsonMsg) => {
    sendDiscordMessage(`MC: ${jsonMsg.toString()}`);
  });

  bot.on('error', (err) => {
    console.error('Minecraft error:', err);
    sendDiscordMessage(`⚠️ Minecraft error: ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason, null, 2);
    console.log('👢 Kicked:', text);
    sendDiscordMessage(`👢 Kicked: \`\`\`${text.slice(0, 1800)}\`\`\``);
  });

  bot.on('end', () => {
    stopAfk();
    mcBot = null;
    if (shouldReconnect) {
      console.log('🔄 Disconnected. Reconnecting in 10s...');
      sendDiscordMessage('🔄 Disconnected. Reconnecting in 10s...');
      setTimeout(createMinecraftBot, 10000);
    } else {
      console.log('Disconnected (manual).');
      sendDiscordMessage('🛑 Disconnected.');
    }
  });

  return bot;
}

// ---------- Slash commands ----------
const slashCommands = [
  new SlashCommandBuilder().setName('connect').setDescription('Connect the MC bot to the server'),
  new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect the MC bot'),
  new SlashCommandBuilder().setName('reauth').setDescription('Clear auth cache and re-login with Microsoft'),
  new SlashCommandBuilder()
    .setName('tell')
    .setDescription('Send a /msg to a player')
    .addStringOption((o) => o.setName('player').setDescription('Player name').setRequired(true))
    .addStringOption((o) => o.setName('
