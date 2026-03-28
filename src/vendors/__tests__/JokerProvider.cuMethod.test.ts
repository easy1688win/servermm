import http from 'http';
import { JokerProvider } from '../JokerProvider';

const readBody = (req: http.IncomingMessage): Promise<string> => {
  return new Promise((resolve) => {
    let out = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      out += chunk;
    });
    req.on('end', () => resolve(out));
  });
};

describe('JokerProvider createPlayer', () => {
  test('sends Method=CU in request body', async () => {
    const bodies: string[] = [];
    const server = http.createServer(async (req, res) => {
      const body = await readBody(req);
      bodies.push(body);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ Status: 'Created' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to start server');

    const provider = new JokerProvider({
      apiUrl: `http://127.0.0.1:${address.port}/api`,
      appId: 'ant88',
      signatureKey: 'test-signature',
    });

    const result = await provider.createPlayer('JK990001');
    expect(result.success).toBe(true);

    server.close();

    expect(bodies.length).toBe(1);
    const parsed = JSON.parse(bodies[0]);
    expect(parsed.Method).toBe('CU');
    expect(parsed.Username).toBe('JK990001');
    expect(typeof parsed.Timestamp).toBe('number');
  });

  test('follows redirect and still posts Method=CU', async () => {
    const received: Array<{ url: string; method: string; body: string }> = [];

    const server = http.createServer(async (req, res) => {
      const body = await readBody(req);
      received.push({ url: req.url || '', method: req.method || '', body });

      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'POST' && u.pathname === '/') {
        res.statusCode = 301;
        res.setHeader('Location', `/api${u.search}`);
        res.end();
        return;
      }

      if (req.method === 'POST' && u.pathname === '/api') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ Status: 'Created' }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to start server');

    const provider = new JokerProvider({
      apiUrl: `http://127.0.0.1:${address.port}/`,
      appId: 'ant88',
      signatureKey: 'test-signature',
    });

    const result = await provider.createPlayer('JK990002');
    expect(result.success).toBe(true);

    server.close();

    expect(received.length).toBe(2);
    expect(received[0].method).toBe('POST');
    expect(new URL(received[0].url, 'http://x').pathname).toBe('/');
    expect(received[1].method).toBe('POST');
    expect(new URL(received[1].url, 'http://x').pathname).toBe('/api');
    const parsed = JSON.parse(received[1].body);
    expect(parsed.Method).toBe('CU');
  });
});

