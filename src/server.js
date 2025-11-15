const express = require("express");
const bodyParser = require("body-parser");
const crypto = require('crypto');
const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
const PORT = 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Replace with your Discord webhook URL

const LOG_FILE = path.join(__dirname, "webhook_logs.txt");

// --- Helpers available to handlers ---
const safe = (v) => (v === undefined || v === null || v === '') ? 'N/A' : v;
const safeAvatar = (url) => (typeof url === 'string' && /^https?:\/\//.test(url) ? url : 'https://i.imgur.com/AfFp7pu.png');
const buildPayload = ({ title, description, fields = [], color = 0x2f3136, timestamp, actorAvatar, footerText }) => {
  return {
    username: 'Monotone Development',
    avatar_url: safeAvatar(actorAvatar),
    content: `${title} — ${description ? description.replace(/\*\*/g, '') : ''}`.trim(),
    embeds: [{
      title: title,
      description: description || undefined,
      color: color,
      fields: fields,
      timestamp: timestamp || new Date().toISOString(),
      thumbnail: { url: safeAvatar(actorAvatar) },
      footer: { text: footerText || 'Plane2Discord' }
    }]
  };
};

function handleCreated(data = {}, activity = {}) {
  const fields = [
    { name: 'Card', value: safe(data.name), inline: true },
    { name: 'Project', value: `ID: \`${safe(data.project)}\``, inline: true },
    { name: 'State', value: safe(data.state?.name), inline: true },
    { name: 'Created At', value: new Date(data.created_at || Date.now()).toLocaleString(), inline: true },
    { name: 'Created By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
  ];

  return buildPayload({
    title: 'New Card Created',
    description: `**${safe(data.name)}** added to project`,
    fields,
    color: convertColor(data.state?.color),
    timestamp: new Date(data.created_at).toISOString(),
    actorAvatar: activity?.actor?.avatar_url,
    footerText: 'Card created'
  });
}

function handleDeleted(data = {}, activity = {}) {
  const fields = [
    { name: 'Card ID', value: safe(data.id), inline: true },
    { name: 'Deleted By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
  ];

  return buildPayload({
    title: 'Card Deleted',
    description: `Card **${safe(data.id)}** has been deleted`,
    fields,
    color: 0xff4444,
    timestamp: new Date().toISOString(),
    actorAvatar: activity?.actor?.avatar_url,
    footerText: 'Card removed'
  });
}

function handleUpdated(data = {}, activity = {}) {
  const actionDesc = getActionDescription(activity);
  const fields = [
    { name: 'Card', value: safe(data.name), inline: true },
    { name: 'Change', value: actionDesc, inline: true },
    { name: 'Project', value: `ID: \`${safe(data.project)}\``, inline: true },
    { name: 'Updated By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
  ];

  return buildPayload({
    title: 'Card Updated',
    description: `**${safe(data.name)}** updated`,
    fields,
    color: convertColor(data.state?.color),
    timestamp: new Date(data.updated_at || Date.now()).toISOString(),
    actorAvatar: activity?.actor?.avatar_url,
    footerText: 'Card updated'
  });
}

// Capture raw body for signature verification
app.use(bodyParser.json({
  verify: function (req, res, buf) {
    req.rawBody = buf;
  }
}));

app.post("/webhook", async (req, res) => {
  const logEntry = `
-------------------
Timestamp: ${new Date().toISOString()}
Headers: ${JSON.stringify(req.headers, null, 2)}
Body: ${JSON.stringify(req.body, null, 2)}
-------------------
    `;

  // Append to log file
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) {
      console.error("Failed to log data:", err);
    }
  });

  // Make sure webhook URL is set
  if (!DISCORD_WEBHOOK_URL) {
    console.error('DISCORD_WEBHOOK_URL is not set. Cannot forward to Discord.');
    return res.status(500).send('DISCORD_WEBHOOK_URL not configured');
  }

  // Signature verification using WEBHOOK_SECRET (HMAC-SHA256)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET is not set. Refusing to accept unsigned requests.');
    return res.status(500).send('WEBHOOK_SECRET not configured');
  }

  const receivedSignature = req.headers['x-plane-signature'] || req.headers['X-Plane-Signature'];
  if (!receivedSignature) {
    console.warn('Missing X-Plane-Signature header');
    return res.status(403).send('Missing signature');
  }

  try {
    // expected: hex digest of HMAC-SHA256 over the raw payload
    const expectedHmac = crypto.createHmac('sha256', webhookSecret).update(req.rawBody || Buffer.from(JSON.stringify(req.body))).digest();
    const receivedBuf = Buffer.from(String(receivedSignature).trim(), 'hex');

    // Timing-safe comparison; lengths must match
    if (receivedBuf.length !== expectedHmac.length || !crypto.timingSafeEqual(expectedHmac, receivedBuf)) {
      console.warn('Invalid signature provided');
      return res.status(403).send('Invalid signature');
    }
  } catch (err) {
    console.error('Error verifying signature:', err && err.message ? err.message : err);
    return res.status(403).send('Invalid signature');
  }

  try {
    const { action, data, activity } = req.body;

    // Dispatch to per-action handlers for clarity
    let discordMessage;
    switch (action) {
      case 'created':
        discordMessage = handleCreated(data, activity);
        break;
      case 'deleted':
        discordMessage = handleDeleted(data, activity);
        break;
      case 'updated':
        discordMessage = handleUpdated(data, activity);
        break;
      default:
        console.log(`Unhandled action: ${action}`);
        return res.sendStatus(200);
    }

    // Send to Discord
    await axios.post(DISCORD_WEBHOOK_URL, discordMessage).catch(err => {
      console.error('Failed to forward to Discord:', err.message || err);
      throw err;
    });
    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});

function getActionDescription(activity) {
  const { field, old_value, new_value } = activity;

  switch (field) {
    case "state_id":
      return `State ID changed from ${old_value} to ${new_value}`;
    case "state":
      return `Moved from **${old_value}** to **${new_value}**`;
    case "sort_order":
      return `Reordered (priority changed)`;
    default:
      return `Field **${field}** updated`;
  }
}

function convertColor(hex) {
  if (!hex) return 0x2f3136; // Default Discord dark gray
  try {
    const cleaned = String(hex).replace('#', '');
    const parsed = parseInt(cleaned, 16);
    return Number.isNaN(parsed) ? 0x2f3136 : parsed;
  } catch (e) {
    return 0x2f3136;
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
