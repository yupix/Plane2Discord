const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
const PORT = 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Replace with your Discord webhook URL

const LOG_FILE = path.join(__dirname, "webhook_logs.txt");

app.use(bodyParser.json());

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

  try {
    const { action, data, activity } = req.body;

    // Helpers to build a clear, safe Discord payload
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

    // Handle different actions with clearer embeds
    let discordMessage;
    switch (action) {
      case 'created': {
        const fields = [
          { name: 'Card', value: safe(data.name), inline: true },
          { name: 'Project', value: `ID: \`${safe(data.project)}\``, inline: true },
          { name: 'State', value: safe(data.state?.name), inline: true },
          { name: 'Created At', value: new Date(data.created_at || Date.now()).toLocaleString(), inline: true },
          { name: 'Created By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
        ];

        discordMessage = buildPayload({
          title: 'New Card Created',
          description: `**${safe(data.name)}** added to project`,
          fields,
          color: convertColor(data.state?.color),
          timestamp: new Date(data.created_at).toISOString(),
          actorAvatar: activity?.actor?.avatar_url,
          footerText: 'Card created'
        });
      }
        break;

      case 'deleted': {
        const fields = [
          { name: 'Card ID', value: safe(data.id), inline: true },
          { name: 'Deleted By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
        ];

        discordMessage = buildPayload({
          title: 'Card Deleted',
          description: `Card **${safe(data.id)}** has been deleted`,
          fields,
          color: 0xff4444,
          timestamp: new Date().toISOString(),
          actorAvatar: activity?.actor?.avatar_url,
          footerText: 'Card removed'
        });
      }
        break;

      case 'updated': {
        // Provide a helpful summary when state changed or other known fields
        const actionDesc = getActionDescription(activity);
        const fields = [
          { name: 'Card', value: safe(data.name), inline: true },
          { name: 'Change', value: actionDesc, inline: true },
          { name: 'Project', value: `ID: \`${safe(data.project)}\``, inline: true },
          { name: 'Updated By', value: `${safe(activity?.actor?.display_name)}`, inline: true }
        ];

        discordMessage = buildPayload({
          title: 'Card Updated',
          description: `**${safe(data.name)}** updated`,
          fields,
          color: convertColor(data.state?.color),
          timestamp: new Date(data.updated_at || Date.now()).toISOString(),
          actorAvatar: activity?.actor?.avatar_url,
          footerText: 'Card updated'
        });
      }
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
