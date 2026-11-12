import type { Credentials } from '../shared/messages';

// A small client for the hosted Wiro AI MCP server at mcp.wiro.ai/v1. The
// endpoint is stateless Streamable HTTP: every call is one POST of a JSON-RPC
// `tools/call`, answered with JSON or with a short SSE stream that ends after
// the result. It takes the project's API key as a Bearer token and serves CORS
// to any origin, which the plugin iframe needs (its origin is "null").

export const MCP_ENDPOINT = 'https://mcp.wiro.ai/v1';
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export class AuthError extends Error {
  constructor(
    message = 'Wiro AI did not accept this API key. Check the key, and the API secret for projects that use signature authentication.',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface ToolResult<T> {
  /** structuredContent, when the tool returns it. */
  structured?: T;
  /** The text content blocks joined, for errors and tools without structured output. */
  text: string;
  isError: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** The Bearer token: the key, or key:secret for signature-based projects. */
export function bearerToken(credentials: Credentials): string {
  return credentials.apiSecret ? `${credentials.apiKey}:${credentials.apiSecret}` : credentials.apiKey;
}

/** Server-sent events: blocks split by a blank line, each `data:` line part of one message. */
export function sseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const block of body.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    if (data.length === 0) continue;
    try {
      messages.push(JSON.parse(data.join('\n')));
    } catch {
      // A keep-alive or priming event, not a JSON-RPC message.
    }
  }
  return messages;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class McpClient {
  private nextId = 1;

  constructor(
    private readonly credentials: () => Credentials | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly endpoint = MCP_ENDPOINT,
  ) {}

  async callTool<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult<T>> {
    const credentials = this.credentials();
    if (!credentials) throw new AuthError('Connect your Wiro AI API key first.');
    const id = this.nextId++;
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${bearerToken(credentials)}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      signal,
    });
    if (response.status === 401 || response.status === 403) throw new AuthError();
    if (response.status === 429) {
      const retry = Number(response.headers.get('Retry-After')) || undefined;
      throw new McpError(
        'Wiro AI is getting too many requests from this key. Wait a moment and try again.',
        429,
        retry,
      );
    }
    if (!response.ok) {
      throw new McpError(`Wiro AI answered with HTTP ${response.status}. Try again in a moment.`, response.status);
    }
    const message = await readMessage(response, id);
    if (message.error) throw new McpError(message.error.message);
    const result = message.result ?? {};
    const text = (result.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
    return { structured: result.structuredContent as T | undefined, text, isError: result.isError === true };
  }
}

async function readMessage(response: Response, id: number): Promise<JsonRpcResponse> {
  const type = response.headers.get('Content-Type') ?? '';
  const body = await response.text();
  const messages = type.includes('text/event-stream') ? sseMessages(body) : [parseJson(body)];
  for (const message of messages) {
    const candidate = message as JsonRpcResponse | undefined;
    if (candidate && candidate.jsonrpc === '2.0' && candidate.id === id) return candidate;
  }
  throw new McpError('Wiro AI sent an answer the plugin could not read.');
}
