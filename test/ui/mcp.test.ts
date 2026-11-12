import { describe, expect, it } from 'vitest';
import { AuthError, bearerToken, McpClient, McpError, MCP_ENDPOINT, sseMessages } from '../../src/ui/mcp';

interface Call {
  url: string;
  init: RequestInit;
}

function respond(body: string, init: { status?: number; type?: string; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.type ?? 'application/json', ...(init.headers ?? {}) },
  });
}

function client(
  reply: (call: Call, id: number) => Response,
  credentials = { apiKey: 'key' } as { apiKey: string; apiSecret?: string } | null,
) {
  const calls: Call[] = [];
  const mcp = new McpClient(
    () => credentials,
    async (url, init) => {
      calls.push({ url, init });
      const id = JSON.parse(String(init.body)).id as number;
      return reply({ url, init }, id);
    },
  );
  return { mcp, calls };
}

describe('McpClient', () => {
  it('posts one tools/call with the key as a Bearer token', async () => {
    const { mcp, calls } = client((_, id) =>
      respond(JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { ok: 1 }, content: [] } })),
    );
    const result = await mcp.callTool('get_account', {});
    expect(result).toEqual({ structured: { ok: 1 }, text: '', isError: false });
    expect(calls[0]!.url).toBe(MCP_ENDPOINT);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key');
    expect(headers.Accept).toContain('text/event-stream');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_account', arguments: {} },
    });
  });

  it('joins key and secret for signature-based projects', () => {
    expect(bearerToken({ apiKey: 'k' })).toBe('k');
    expect(bearerToken({ apiKey: 'k', apiSecret: 's' })).toBe('k:s');
  });

  it('reads an answer sent as server-sent events', async () => {
    const { mcp } = client((_, id) =>
      respond(
        `: keep-alive\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\n` +
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '## Error\n\nNo' }], isError: true } })}\n\n`,
        { type: 'text/event-stream' },
      ),
    );
    expect(await mcp.callTool('run_model', {})).toEqual({
      structured: undefined,
      text: '## Error\n\nNo',
      isError: true,
    });
  });

  it('turns 401 into AuthError and 429 into McpError with the wait', async () => {
    await expect(client(() => respond('{}', { status: 401 })).mcp.callTool('x', {})).rejects.toBeInstanceOf(AuthError);
    const limited = client(() => respond('{}', { status: 429, headers: { 'Retry-After': '7' } }));
    const error = await limited.mcp.callTool('x', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).retryAfterSeconds).toBe(7);
  });

  it('refuses to call without a key', async () => {
    const { mcp, calls } = client(() => respond('{}'), null);
    await expect(mcp.callTool('x', {})).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(0);
  });

  it('reports JSON-RPC errors and answers for another request', async () => {
    const failing = client((_, id) =>
      respond(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Bad args' } })),
    );
    await expect(failing.mcp.callTool('x', {})).rejects.toThrow('Bad args');
    const stray = client(() => respond(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} })));
    await expect(stray.mcp.callTool('x', {})).rejects.toBeInstanceOf(McpError);
  });

  it('parses multi-line SSE data and skips non-JSON events', () => {
    expect(sseMessages('data: {"a":\ndata: 1}\n\ndata: ping\n\n')).toEqual([{ a: 1 }]);
  });
});
