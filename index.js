require('dotenv').config();
const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const { PublicClientApplication } = require('@azure/msal-node');
const fs = require('fs');
const path = require('path');

const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = Number(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
const MC_USERNAME = process.env.MC_USERNAME || 'DonutBot';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '/';

const TOKEN_FILE = path.join(__dirname, 'auth_token.json');

// Microsoft OAuth Config
const msalConfig = {
  auth: {
    clientId: '00000000402b5328',
    authority: 'https://login.microsoftonline.com/consumers'
  }
};

const msalClient = new PublicClientApplication(msalConfig);

function loadStoredToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load stored token:', err.message);
  }
  return null;
}

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
    console.log('✓ Authentication token saved');
  } catch (err) {
    console.error('Failed to save token:', err);
  }
}

async function authenticate() {
  try {
    const storedToken = loadStoredToken();

    // Try to use cached token first
    if (storedToken && storedToken.expiresOn > Date.now()) {
      console.log('✓ Using cached authentication token');
      return storedToken.accessToken;
    }

    console.log('\n🔐 Starting Device Code Flow Authentication...');

    const deviceCodeRequest = {
      clientId: msalConfig.auth.clientId,
      scopes: ['XboxLive.signin', 'offline_access'],
      deviceCodeCallback: (response) => {
        console.log('\n📱 Open this link and sign in:');
        console.log(response.verificationUri);
        console.log('\nEnter this code: ' + response.userCode);
        console.log('(Code expires in ' + response.expiresIn + ' seconds)\n');
      }
    };

    const tokenResponse = await msalClient.acquireTokenByDeviceCode(deviceCodeRequest);
    saveToken(tokenResponse);
    return tokenResponse.accessToken;
  } catch (err) {
    console.error('Authentication failed:', err.message);
    throw err;
  }
}

const hasDiscordBot = Boolean(DISCORD_TOKEN && DISCORD_CHANNEL_ID);
const hasWebhook = Boolean(DISCORD_WEBHOOK_URL);

if (!hasDiscordBot && !hasWebhook) {
  console.error('You must provide either DISCORD_TOKEN + DISCORD_CHANNEL_ID for command input, or DISCORD_WEBHOOK_URL for output.');
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
let webhookClient = hasWebhook ? new WebhookClient({ url: DISCORD_WEBHOOK_URL }) : null;
let mcBot;

function sendDiscordMessage(content) {
  if (webhookClient) {
    return webhookClient.send({ content }).catch((err) => {
      console.error('Webhook send failed:', err);
    });
  }

  if (discordChannel) {
    return discordChannel.send(content).catch((err) => {
      console.error('Discord channel send failed:', err);
    });
  }

  return Promise.resolve();
}

function createMinecraftBot() {
  const options = {
    host: MC_HOST,
    port: MC_PORT,
    version: MC_VERSION,
    username: 'bedorehab@gmail.com', // Your Microsoft email
    password: 'gxBjjQysN7fjvyBU', // Your Microsoft password
    auth: 'microsoft'
  };

  mcBot = mineflayer.createBot(options);

  mcBot.once('spawn', () => {
    console.log(`Minecraft bot connected as ${mcBot.username}`);
    sendDiscordMessage(`Minecraft bot connected as **${mcBot.username}**.`);
  });

  mcBot.on('chat', (username, message) => {
    if (username === mcBot.username) return;
    sendDiscordMessage(`**${username}**: ${message}`);
  });

  mcBot.on('message', (jsonMsg) => {
    sendDiscordMessage(`Minecraft: ${jsonMsg.toString()}`);
  });

  mcBot.on('error', (err) => {
    console.error('Minecraft error:', err);
    sendDiscordMessage(`Minecraft error: ${err.message}`);
  });

  mcBot.on('end', () => {
    console.log('Minecraft bot disconnected. Reconnecting in 10 seconds...');
    sendDiscordMessage('Minecraft bot disconnected. Reconnecting in 10 seconds...');
    setTimeout(createMinecraftBot, 10000);
  });
}

async function start() {
  console.log('Starting Minecraft bot...');
  createMinecraftBot();
}

start();
