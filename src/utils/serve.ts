import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';

export function serve(handler: (req: Request) => Promise<Response> | Response, opts: { port: number }) {
  const server = createServer(async (req, res) => {
  const protocol = (req.socket as unknown as { encrypted?: boolean }).encrypted ? 'https' : 'http';
    const host = req.headers.host || `localhost:${opts.port}`;
    const url = `${protocol}://${host}${req.url}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, String(v));
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    await new Promise<void>((resolve) => req.on('end', () => resolve()));
    const bodyBuf = Buffer.concat(chunks);

    const request = new Request(url, {
      method: req.method,
      headers,
      body: bodyBuf.length ? bodyBuf : undefined,
    });

    try {
      const response = await handler(request as Request);
      // Build plain object from Headers because Object.fromEntries may not accept Headers in some TS configs
      const headersObj: Record<string, string> = {};
      try {
        response.headers.forEach((value, key) => {
          headersObj[key] = value;
        });
      } catch {
        // fallback: attempt iterator
        for (const [k, v] of (response.headers as any)) {
          headersObj[String(k)] = String(v);
        }
      }

      res.writeHead(response.status, headersObj);
      const ab = await response.arrayBuffer();
      res.end(Buffer.from(ab));
    } catch (err) {
      console.error('Error in request handler:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  server.listen(opts.port);
  console.log(`Server listening on http://localhost:${opts.port}`);
}
