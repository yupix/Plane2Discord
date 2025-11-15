// Deno-based server implementation using std/http
import { serve } from "https://deno.land/std@0.201.0/http/server.ts";
import "https://deno.land/std@0.201.0/dotenv/load.ts";
import { handleCreated, handleDeleted, handleUpdated } from './utils/handlers.ts';
import { WebhookBody } from "./types.ts";

const PORT = Number(Deno.env.get('PORT') || '3000');
const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL');
const LOG_FILE = new URL('../webhook_logs.txt', import.meta.url).pathname;

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function computeHmac(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // Ensure we pass a plain ArrayBuffer for the slice of the Uint8Array
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const sig = await crypto.subtle.sign('HMAC', key, ab);
  return new Uint8Array(sig as ArrayBuffer);
}

async function appendLog(entry: string) {
  try {
    const file = await Deno.open(LOG_FILE, { create: true, append: true });
    await file.write(new TextEncoder().encode(entry));
    file.close();
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

serve(async (req: Request) => {
  const rawBuf = new Uint8Array(await req.arrayBuffer());
  const headersObj = Object.fromEntries([...req.headers]) as Record<string, string>;
  const bodyText = new TextDecoder().decode(rawBuf || new Uint8Array());
  let bodyJson: unknown = {};
  try { bodyJson = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { bodyJson = {}; }

  const logEntry = `\n-------------------\nTimestamp: ${new Date().toISOString()}\nHeaders: ${JSON.stringify(headersObj, null, 2)}\nBody: ${JSON.stringify(bodyJson, null, 2)}\n-------------------\n`;
  appendLog(logEntry);

  if (!DISCORD_WEBHOOK_URL) {
    console.error('DISCORD_WEBHOOK_URL is not set. Cannot forward to Discord.');
    return new Response('DISCORD_WEBHOOK_URL not configured', { status: 500 });
  }

  // const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  // if (!webhookSecret) {
  //   console.error('WEBHOOK_SECRET is not set. Refusing to accept unsigned requests.');
  //   return new Response('WEBHOOK_SECRET not configured', { status: 500 });
  // }

  // const receivedSignature = req.headers.get('x-plane-signature') || req.headers.get('X-Plane-Signature');
  // if (!receivedSignature) {
  //   console.warn('Missing X-Plane-Signature header');
  //   return new Response('Missing signature', { status: 403 });
  // }

  try {
    // const expected = await computeHmac(webhookSecret, rawBuf);
    // receivedSignature is hex
    // const receivedBuf = new Uint8Array(receivedSignature.trim().match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
    // if (receivedBuf.length !== expected.length || !timingSafeEqual(expected, receivedBuf)) {
    //   console.warn('Invalid signature provided');
    //   return new Response('Invalid signature', { status: 403 });
    // }
  } catch (err) {
    console.error('Error verifying signature:', err);
    return new Response('Invalid signature', { status: 403 });
  }

  try {
    const payload = bodyJson as WebhookBody;
    // parse path for workspace slug: support /webhook/:slug and /:slug/webhook
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    let workspaceSlug: string | undefined;
    if (parts.length >= 2 && parts[0] === 'webhook') {
      // /webhook/:slug
      workspaceSlug = parts[1];
    } else if (parts.length >= 2 && parts[1] === 'webhook') {
      // /:slug/webhook
      workspaceSlug = parts[0];
    }

    // ヘッダー
    // if we have a slug, prefer it as the workspace identifier
    const effectivePayload = workspaceSlug ? ({ ...payload, workspace_id: workspaceSlug } as WebhookBody) : payload;

    let discordMessage: unknown;

    switch (payload.action) {
      case 'created':
        discordMessage = await handleCreated(effectivePayload);
        break;
      case 'deleted':
        discordMessage = await handleDeleted(effectivePayload);
        break;
      case 'updated':
        discordMessage = await handleUpdated(effectivePayload);
        break;
      default:
        console.log('Unhandled action:', JSON.stringify(payload));
        return new Response('ok', { status: 200 });
    }

    const resp = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(discordMessage) });
    if (!resp.ok) {
      console.error('Failed to forward to Discord:', resp.status, await resp.text());
      return new Response('Failed to forward to Discord', { status: 502 });
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}, { port: PORT });
