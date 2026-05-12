// index.js — Minecraft <-> Discord bridge bot
// Features: chat relay, tpa/tpahere/tpaccept/tell/rtp/afk commands,
// settings GUI auto-toggle (state-aware), AFK teleport -> /spawn 1,
// connect/disconnect/reauth, chat signing disabled, version pinned.

const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// ---------- CONFIG ----------
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL = process.env.DISCORD_CHANNEL;       // channel ID for relay
const MC_HOST         = process.env.MC_HOST   || 'donutsmp.net';
const MC_PORT         = parseInt(process.env.MC_PORT || '25565', 10);
const MC_USERNAME     = process.env.MC_USERNAME;            // Microsoft email
const MC_VERSION      = process.env.MC_VERSION || '1.20.4'; // pinned for stability
const PREFIX          = '!';

// ---------- DISCORD ----------
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

let discordChannel = null;

function sendDiscordMessage(content) {
  if (!discordChannel) return;
  try {
    discordChannel.send(content.length > 1900 ? content.slice(0, 1900) + '…' : content);
  } catch (e) {
    console.error('Discord send failed:', e.message);
  }
}

// ---------- MINECRAFT ----------
let bot = null;
let settingsConfigured = false;
let manualDisconnect = false;

function getItemText(item) {
  if (!item) return '';
  let text = '';
  try {
    if (item.customName)  text += item.customName + ' ';
    if (item.displayName) text += item.displayName + ' ';
    if (item.nbt)         text += JSON.stringify(item.nbt) + ' ';
  } catch (e) {}
  return text.toLowerCase();
}

function isEnabled(item) {
  const t = getItemText(item);
  if (/currently:?\s*(enabled|on|true)/i.test(t))  return true;
  if (/currently:?\s*(disabled|off|false)/i.test(t)) return false;
  if (item && item.enchants && item.enchants.length > 0) return true;
  return null;
}

function createMinecraftBot() {
  if (bot) {
    try { bot.removeAllListeners(); bot.end(); } catch (e) {}
    bot = null;
  }

  manualDisconnect = false;
  settingsConfigured = false;

  console.log(`[mc] connecting to ${MC_HOST}:${MC_PORT} as ${MC_USERNAME} (v${MC_VERSION})`);

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USERNAME,
    auth: 'microsoft',
    version: MC_VERSION,
    disableChatSigning: true,
    checkTimeoutInterval: 60_000,
  });

  bot.once('spawn', () => {
    console.log('[mc] spawned as ' + bot.username);
    sendDiscordMessage('✅ Minecraft bot connected as **' + bot.username + '**.');
    settingsConfigured = false;

    // Open settings ~5s after spawn (only if not already configured)
    setTimeout(() => {
      if (!settingsConfigured && bot && bot.player) {
        try { bot.chat('/settings'); } catch (e) {}
      }
    }, 5000);
  });

  // ---- Settings GUI auto-toggle (state aware) ----
  bot.on('windowOpen', async (window) => {
    if (settingsConfigured) return;
    const title = window.title ? JSON.stringify(window.title).toLowerCase() : '';
    if (!title.includes('settings')) return;

    settingsConfigured = true;

    try {
      const slotsToDisable = [
        { slot: 0,  name: 'public chat' },
        { slot: 15, name: 'mob spawns' },
      ];

      const results = [];
      for (const { slot, name } of slotsToDisable) {
        const item = window.slots[slot];
        const state = isEnabled(item);
        console.log(`[settings] ${name} slot=${slot} state=${state} text=${getItemText(item)}`);

        if (state === true) {
          await bot.clickWindow(slot, 0, 0);
          await new Promise((r) => setTimeout(r, 400));
          results.push(`${name}: disabled`);
        } else if (state === false) {
          results.push(`${name}: already off`);
        } else {
          results.push(`${name}: unknown (skipped)`);
        }
      }

      sendDiscordMessage('⚙️ ' + results.join(' | '));
      setTimeout(() => { try { bot.closeWindow(window); } catch (e) {} }, 500);
    } catch (e) {
      console.error('[settings] toggle failed:', e);
      sendDiscordMessage('⚠️ Settings toggle failed: ' + e.message);
    }
  });

  // ---- Single message handler: relay + AFK teleport detection ----
  bot.on('message', (jsonMsg) => {
    let text = '';
    try { text = jsonMsg.toString(); } catch (e) { return; }
    if (!text || !text.trim()) return;

    // AFK teleport -> /spawn 1
    if (/you teleported to afk\s*#?\d+/i.test(text)) {
      sendDiscordMessage('🚨 Teleport detected!');
      setTimeout(() => {
        try { bot.chat('/spawn 1'); } catch (e) {}
      }, 1000);
    }

    sendDiscordMessage(text.slice(0, 1900));
  });

  bot.on('kicked', (reason) => {
    console.log('[mc] kicked:', reason);
    sendDiscordMessage('❌ Kicked: ```' + String(reason).slice(0, 1800) + '```');
  });

  bot.on('error', (err) => {
    console.error('[mc] error:', err.message);
    sendDiscordMessage('⚠️ MC error: ' + err.message);
  });

  bot.on('end', (reason) => {
    console.log('[mc] disconnected:', reason);
    sendDiscordMessage('🔌 Bot disconnected (' + reason + ').');
    if (!manualDisconnect) {
      console.log('[mc] auto-reconnecting in 15s...');
      setTimeout(createMinecraftBot, 15_000);
    }
  });
}

// ---------- DISCORD COMMANDS ----------
discord.once('ready', () => {
  console.log('[discord] logged in as ' + discord.user.tag);
  discord.channels.fetch(DISCORD_CHANNEL).then((ch) => {
    discordChannel = ch;
    sendDiscordMessage('🤖 Bridge online. Use `' + PREFIX + 'connect` to start the MC bot.');
  }).catch((e) => console.error('[discord] channel fetch failed:', e));
});

discord.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== DISCORD_CHANNEL) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd  = (args.shift() || '').toLowerCase();

  switch (cmd) {
    case 'connect':
      if (bot && bot.player) return msg.reply('Already connected.');
      msg.reply('Connecting...');
      createMinecraftBot();
      break;

    case 'disconnect':
      if (!bot) return msg.reply('Not connected.');
      manualDisconnect = true;
      try { bot.end(); } catch (e) {}
      msg.reply('Disconnected (auto-reconnect disabled).');
      break;

    case 'reauth':
      msg.reply('Reconnecting fresh...');
      manualDisconnect = true;
      try { if (bot) bot.end(); } catch (e) {}
      setTimeout(() => { manualDisconnect = false; createMinecraftBot(); }, 2000);
      break;

    case 'say':
      if (!bot) return msg.reply('Bot not connected.');
      try { bot.chat(args.join(' ')); } catch (e) { msg.reply('Failed: ' + e.message); }
      break;

    case 'tpa':
      if (!bot) return msg.reply('Bot not connected.');
      if (!args[0]) return msg.reply('Usage: `!tpa <player>`');
      bot.chat('/tpa ' + args[0]);
      break;

    case 'tpahere':
      if (!bot) return msg.reply('Bot not connected.');
      if (!args[0]) return msg.reply('Usage: `!tpahere <player>`');
      bot.chat('/tpahere ' + args[0]);
      break;

    case 'tpaccept':
      if (!bot) return msg.reply('Bot not connected.');
      bot.chat('/tpaccept');
      break;

    case 'tpdeny':
      if (!bot) return msg.reply('Bot not connected.');
      bot.chat('/tpdeny');
      break;

    case 'rtp':
      if (!bot) return msg.reply('Bot not connected.');
      bot.chat('/rtp');
      break;

    case 'spawn':
      if (!bot) return msg.reply('Bot not connected.');
      bot.chat('/spawn ' + (args[0] || ''));
      break;

    case 'afk':
      if (!bot) return msg.reply('Bot not connected.');
      bot.chat('/afk');
      break;

    case 'tell':
    case 'msg':
    case 'w': {
      if (!bot) return msg.reply('Bot not connected.');
      const target = args.shift();
      const body   = args.join(' ');
      if (!target || !body) return msg.reply('Usage: `!tell <player> <message>`');
      bot.chat('/msg ' + target + ' ' + body);
      break;
    }

    case 'status':
      if (!bot || !bot.player) return msg.reply('Not connected.');
      msg.reply(`Connected as **${bot.username}** | Health: ${bot.health?.toFixed(1)} | Food: ${bot.food} | Pos: ${bot.entity?.position?.floored?.()}`);
      break;

    case 'help':
      msg.reply([
        '**Commands:**',
        '`!connect` / `!disconnect` / `!reauth`',
        '`!status`',
        '`!say <text>` — public chat (will be blocked if chat off)',
        '`!tell <player> <msg>` — private DM',
        '`!tpa <player>` / `!tpahere <player>` / `!tpaccept` / `!tpdeny`',
        '`!rtp` / `!spawn [n]` / `!afk`',
      ].join('\n'));
      break;

    default:
      msg.reply('Unknown command. Try `!help`.');
  }
});

// ---------- BOOT ----------
discord.login(DISCORD_TOKEN).catch((e) => {
  console.error('[discord] login failed:', e);
  process.exit(1);
});

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
process.on('uncaughtException',  (e) => console.error('[uncaught]', e));
