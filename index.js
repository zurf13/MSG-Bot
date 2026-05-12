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

const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = Number(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.21.4';
const MC_USERNAME = process.env.MC_USERNAME || 'DonutBot';
const AUTH_CACHE = process.env.AUTH_CACHE || './auth-cache';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const hasDiscordBot = Boolean(DISCORD_TOKEN && DISCORD_CHANNEL_ID);
const hasWebhook = Boolean(DISCORD_WEBHOOK_URL);

if (!hasDiscordBot && !hasWebhook) {
  console.error('Need DISCORD_TOKEN + DISCORD_CHANNEL_ID, or DISCORD_WEBHOOK_URL.');
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

let mcBot = null;
let shouldReconnect = true;
let afkInterval = null;

function sendDiscordMessage(content) {
  if (webhookClient) {
    return webhookClient.send({ content }).catch((e) => console.error('Webhook fail:', e));
  }
  if (discordChannel) {
    return discordChannel.send(content).catch((e) => console.error('Channel fail:', e));
  }
  return Promise.resolve();
}

function stopAfk() {
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }
}

function createMinecraftBot() {
  shouldReconnect = true;

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    version: MC_VERSION,
    username: MC_USERNAME,
    auth: 'microsoft',
    profilesFolder: AUTH_CACHE,
    disableChatSigning: true,
    onMsaCode: (data) => {
      const msg = '🔐 **Microsoft login required**\nGo to <' + data.verification_uri + '> and enter code: `' + data.user_code + '`\n(Expires in ' + data.expires_in + 's)';
      console.log('\n' + msg + '\n');
      sendDiscordMessage(msg);
    },
  });

  mcBot = bot;

  bot.once('spawn', () => {
    console.log('Connected as ' + bot.username);
    sendDiscordMessage('✅ Minecraft bot connected as **' + bot.username + '**.');
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    sendDiscordMessage('**' + username + '**: ' + message);
  });

  bot.on('message', (jsonMsg) => {
    sendDiscordMessage('MC: ' + jsonMsg.toString());
  });

  bot.on('error', (err) => {
    console.error('MC error:', err);
    sendDiscordMessage('⚠️ MC error: ' + err.message);
  });

  bot.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason, null, 2);
    console.log('Kicked:', text);
    sendDiscordMessage('👢 Kicked: ```' + text.slice(0, 1800) + '```');
  });

  bot.on('end', () => {
    stopAfk();
    mcBot = null;
    if (shouldReconnect) {
      console.log('Disconnected. Reconnecting in 30s...');
      sendDiscordMessage('🔄 Disconnected. Reconnecting in 30s...');
      setTimeout(createMinecraftBot, 30000);
    } else {
      sendDiscordMessage('🛑 Disconnected.');
    }
  });

  return bot;
}

const slashCommands = [
  new SlashCommandBuilder().setName('connect').setDescription('Connect the MC bot'),
  new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect the MC bot'),
  new SlashCommandBuilder().setName('reauth').setDescription('Clear auth cache and re-login'),
  new SlashCommandBuilder()
    .setName('tell')
    .setDescription('Send a /msg to a player')
    .addStringOption((o) => o.setName('player').setDescription('Player name').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('afk').setDescription('Toggle AFK mode'),
  new SlashCommandBuilder()
    .setName('rtp')
    .setDescription('Random teleport')
    .addStringOption((o) =>
      o.setName('world').setDescription('Destination').setRequired(true).addChoices(
        { name: 'east', value: 'east' },
        { name: 'nether', value: 'nether' },
        { name: 'end', value: 'end' }
      )
    ),
  new SlashCommandBuilder()
    .setName('tpa')
    .setDescription('Send a /tpa to a player')
    .addStringOption((o) => o.setName('player').setDescription('Player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('tpahere')
    .setDescription('Send a /tpahere to a player')
    .addStringOption((o) => o.setName('player').setDescription('Player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('tpaccept')
    .setDescription('Accept a tpa request (username optional)')
    .addStringOption((o) => o.setName('player').setDescription('Player name (optional)').setRequired(false)),
].map((c) => c.toJSON());

async function registerSlashCommands() {
  if (!DISCORD_CLIENT_ID) {
    console.warn('DISCORD_CLIENT_ID not set — skipping slash registration.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    if (DISCORD_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
        { body: slashCommands }
      );
      console.log('Slash commands registered (guild).');
    } else {
      await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID),
        { body: slashCommands }
      );
      console.log('Slash commands registered (global).');
    }
  } catch (err) {
    console.error('Slash register failed:', err);
