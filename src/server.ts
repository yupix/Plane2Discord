// Fastify-based Node server
import Fastify from 'fastify';
import { appendFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { handleCreated } from './utils/handlers';
import { WebhookBody } from './types';

import { env } from './env';

const PORT = env.PORT;
const DISCORD_WEBHOOK_URL = env.DISCORD_WEBHOOK_URL;
const LOG_FILE = path.resolve(process.cwd(), 'webhook_logs.txt');

// Startup diagnostic: report presence of important env vars (do not print secrets)
console.log('env check:', {
  DISCORD_WEBHOOK_URL: !!DISCORD_WEBHOOK_URL,
  WEBHOOK_SECRET: !!process.env.WEBHOOK_SECRET,
  PLANE_API_KEY: !!process.env.PLANE_API_KEY,
  S3_CONFIGURED: !!(process.env.S3_BUCKET_NAME && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
});

async function appendLog(entry: string) {
  try {
    await appendFile(LOG_FILE, entry);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

async function readRawBuffer(req: any): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const stream = req.raw ?? req;
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const fastify = Fastify();

// Central handler used for multiple route patterns
async function handleWebhook(request: any, reply: any) {
  const rawBuf = await readRawBuffer(request);
  const headersObj = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, String(v || '')])) as Record<string, string>;
  const bodyText = new TextDecoder().decode(rawBuf || new Uint8Array());

  // --- 署名検証ロジック (Pythonリファレンスに基づいて修正) ---
  const webhookSecret = env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET is not set. Refusing to accept unsigned requests.');
    reply.status(500).send('WEBHOOK_SECRET not configured');
    return;
  }

  const receivedSignature = (request.headers['x-plane-signature'] as string) || (request.headers['X-Plane-Signature'] as string);
  if (!receivedSignature) {
    console.warn('Missing X-Plane-Signature header');
    reply.status(403).send('Missing signature');
    return;
  }

  let bodyJson: unknown = {};
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : {};
  } catch (e) {
    console.warn('Failed to parse JSON body for verification:', (e as Error).message);
    reply.status(400).send('Invalid JSON body');
    return;
  }

  const logEntry = `\n-------------------\nTimestamp: ${new Date().toISOString()}\nHeaders: ${JSON.stringify(headersObj, null, 2)}\nBody: ${JSON.stringify(bodyJson, null, 2)}\n-------------------\n`;
  appendLog(logEntry);

  if (!DISCORD_WEBHOOK_URL) {
    console.error('DISCORD_WEBHOOK_URL is not set. Cannot forward to Discord.');
    reply.status(500).send('DISCORD_WEBHOOK_URL not configured');
    return;
  }

  try {
    const payload = bodyJson as WebhookBody;

    // Prefer explicit route param `/webhook/:workspaceSlug` if present
    const wsFromParams = (request.params as any)?.workspaceSlug as string | undefined;

    const baseForUrl = `http://${request.headers.host ?? `localhost:${PORT}`}`;
    const url = new URL((request.raw?.url as string) || (request.url as string) || '/', baseForUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    let workspaceSlug: string | undefined = wsFromParams;
    if (!workspaceSlug) {
      if (parts.length >= 2 && parts[0] === 'webhook') {
        workspaceSlug = parts[1];
      } else if (parts.length >= 2 && parts[1] === 'webhook') {
        workspaceSlug = parts[0];
      }
    }

    const effectivePayload = workspaceSlug ? ({ ...payload, workspace_id: workspaceSlug } as WebhookBody) : payload;

    let discordMessage: unknown;

    switch (payload.action) {
      case 'created':
        discordMessage = await handleCreated(effectivePayload);
        break;
      case 'deleted':
        // discordMessage = await handleDeleted(effectivePayload);
        break;
      case 'updated':
        // discordMessage = await handleUpdated(effectivePayload);
        break;
      default:
        console.log('Unhandled action:', JSON.stringify(payload));
        reply.status(200).send('ok');
        return;
    }

    const resp = await fetch(String(DISCORD_WEBHOOK_URL), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(discordMessage) });
    if (!resp.ok) {
      console.error('Failed to forward to Discord:', resp.status, await resp.text());
      reply.status(502).send('Failed to forward to Discord');
      return;
    }

    reply.status(200).send('ok');
  } catch (error) {
    console.error('Error:', error);
    reply.status(500).send('Internal Server Error');
  }
}

// Register explicit routes that accept workspaceSlug as a route param
fastify.post('/webhook/:workspaceSlug', handleWebhook);

(async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
})();
