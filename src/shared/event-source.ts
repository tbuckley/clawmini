import http from 'node:http';

export function createUnixSocketEventSource(socketPath: string) {
  return class UnixSocketEventSource {
    public readyState: number = 0; // CONNECTING
    public readonly CONNECTING = 0;
    public readonly OPEN = 1;
    public readonly CLOSED = 2;

    req: http.ClientRequest | null = null;
    listeners: Record<string, ((event: Record<string, unknown>) => void)[]> = {};

    constructor(url: string, init?: Record<string, unknown>) {
      const parsedUrl = new URL(url);

      const options: http.RequestOptions = {
        socketPath,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...(init?.headers as Record<string, string> | undefined),
        },
      };

      this.req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          this.readyState = this.OPEN;
          this.dispatchEvent({ type: 'open' });
        } else {
          this.readyState = this.CLOSED;
          this.dispatchEvent({
            type: 'error',
            message: `Unexpected status code: ${res.statusCode}`,
          });
          return;
        }

        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split(/\r?\n\r?\n/);
          buffer = lines.pop() || '';

          for (const block of lines) {
            this.parseBlock(block);
          }
        });

        res.on('end', () => {
          if (buffer) this.parseBlock(buffer);
          this.readyState = this.CLOSED;
          this.dispatchEvent({ type: 'close' });
        });
      });

      this.req.on('error', (err) => {
        this.readyState = this.CLOSED;
        this.dispatchEvent({ type: 'error', error: err });
      });

      this.req.end();
    }

    parseBlock(block: string) {
      if (!block.trim()) return;

      const lines = block.split(/\r?\n/);
      let eventType = 'message';
      let data = '';
      let id = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          data += (data ? '\n' : '') + line.slice(6);
        } else if (line.startsWith('id: ')) {
          id = line.slice(4).trim();
        }
      }

      if (data) {
        this.dispatchEvent({
          type: eventType,
          data,
          lastEventId: id,
        });
      }
    }

    public addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(listener);
    }

    public removeEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      if (!this.listeners[type]) return;
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }

    dispatchEvent(event: Record<string, unknown>) {
      const type = event.type as string;
      if (this.listeners[type]) {
        for (const listener of this.listeners[type]) {
          listener(event);
        }
      }
    }

    public close() {
      this.readyState = this.CLOSED;
      if (this.req) {
        this.req.destroy();
      }
    }
  };
}
