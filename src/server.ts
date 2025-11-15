// app.ts (Elysia.js-based Bun server)
import { Elysia } from 'elysia';
import path from 'node:path';

import { handleCreated } from './utils/handlers';
import { WebhookBody } from './types';
import { env } from './env';

const PORT = env.PORT;
const DISCORD_WEBHOOK_URL = env.DISCORD_WEBHOOK_URL;
const LOG_FILE = path.resolve(process.cwd(), 'webhook_logs.txt');

// Startup diagnostic: (Same as before)
console.log('env check:', {
  DISCORD_WEBHOOK_URL: !!DISCORD_WEBHOOK_URL,
  WEBHOOK_SECRET: !!process.env.WEBHOOK_SECRET,
  PLANE_API_KEY: !!process.env.PLANE_API_KEY,
  S3_CONFIGURED: !!(process.env.S3_BUCKET_NAME && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
});

/**
 * Bun.write を使用した非同期ログ追記
 * @param entry - ログエントリー文字列
 */
async function appendLog(entry: string) {
  try {
    // Bun.write は append オプションをサポートしています
    const file = Bun.file(LOG_FILE);
    let currentContent = await file.text();
    currentContent += entry;

    await file.write(currentContent);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

const app = new Elysia()
  .post(
    '/webhook/:workspaceSlug',
    async ({ body, headers, params, set, request }) => {
      // body は { type: 'text' } のため、パース前の生テキスト
      
      // ヘッダーオブジェクトを作成 (ログ用)
      const headersObj = Object.fromEntries(request.headers.entries());

      // --- 署名検証ロジック (Bun.CryptoHasher を使用して *正しく* 実装) ---
      // const webhookSecret = env.WEBHOOK_SECRET;
      // if (!webhookSecret) {
      //   console.error('WEBHOOK_SECRET is not set. Refusing to accept requests.');
      //   set.status = 500;
      //   return 'WEBHOOK_SECRET not configured';
      // }

      // const receivedSignature = headers['x-plane-signature'] || headers['X-Plane-Signature'];
      // if (!receivedSignature) {
      //   console.warn('Missing X-Plane-Signature header');
      //   set.status = 403;
      //   return 'Missing signature';
      // }

      // // Bun の API で HMAC-SHA256 署名を計算
      // const hmac = new CryptoHasher('sha256', Buffer.from(webhookSecret));
      // hmac.update(bodyText);
      // const expectedSignature = hmac.digest('hex');

      // try {
      //   // Bun の timingSafeEqual で比較
      //   if (!timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) {
      //     console.warn('Invalid signature');
      //     set.status = 403;
      //     return 'Invalid signature';
      //   }
      // } catch (e) {
      //   // timingSafeEqual はバッファ長が異なるとエラーをスローすることがある
      //   console.warn('Signature comparison failed:', e);
      //   set.status = 403;
      //   return 'Invalid signature format';
      // }
      
      // --- 署名検証完了 ---


      // ログ追記
      const logEntry = `\n-------------------\nTimestamp: ${new Date().toISOString()}\nHeaders: ${JSON.stringify(headersObj, null, 2)}\nBody: ${JSON.stringify(body, null, 2)}\n-------------------\n`;
      await appendLog(logEntry);

      if (!DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set. Cannot forward to Discord.');
        set.status = 500;
        return 'DISCORD_WEBHOOK_URL not configured';
      }

      try {
        const payload = body as WebhookBody;

        // Elysia では :workspaceSlug が params から直接取得できる
        const workspaceSlug = params.workspaceSlug;

        // Fastify 版にあった複雑なURLパースロジックは、
        // Elysia の型指定されたルートパラメータで不要になります。
        const effectivePayload = workspaceSlug 
          ? ({ ...payload, workspace_id: workspaceSlug } as WebhookBody) 
          : payload;

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
            set.status = 200;
            return 'ok'; // 'reply.send' の代わりに 'return'
        }

        const resp = await fetch(String(DISCORD_WEBHOOK_URL), { 
          method: 'POST', 
          headers: { 'content-type': 'application/json' }, 
          body: JSON.stringify(discordMessage) 
        });

        if (!resp.ok) {
          console.error('Failed to forward to Discord:', resp.status, await resp.text());
          set.status = 502;
          return 'Failed to forward to Discord';
        }

        set.status = 200;
        return 'ok';
      } catch (error) {
        console.error('Error:', error);
        set.status = 500;
        return 'Internal Server Error';
      }
    },
    {
      // ★ これが重要: 
      // Elysia に body を自動で JSON パースさせず、
      // 生のテキストとして 'body' 変数に渡すよう指示
      type: 'text',
    }
  )
  .listen(PORT, () => {
    console.log(`🦊 Elysia server listening on http://0.0.0.0:${PORT}`);
  });