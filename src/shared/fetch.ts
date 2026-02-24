import http from 'node:http';

export function createUnixSocketFetch(socketPath: string) {
  return async (
    input: string | URL | globalThis.Request,
    init?: unknown
  ): Promise<globalThis.Response> => {
    const urlString =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlString);

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath,
        path: url.pathname + url.search,
        method: (init as globalThis.RequestInit)?.method || 'GET',
        headers: ((init as globalThis.RequestInit)?.headers as Record<string, string>) || {},
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          const response = new Response(body, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || 'OK',
            headers: new Headers(res.headers as Record<string, string>),
          });

          resolve(response);
        });
        res.on('error', reject);
      });

      req.on('error', reject);

      if ((init as globalThis.RequestInit)?.body) {
        req.write((init as globalThis.RequestInit)?.body as string | Buffer | Uint8Array);
      }
      req.end();
    });
  };
}
