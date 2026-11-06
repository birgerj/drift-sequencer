/**
 * The Claude API, called straight from the browser. Each user brings their
 * own API key; it is kept in this browser's localStorage only (never in the
 * project, so exporting or sharing a project never shares the key).
 */

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Haiku · fast' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet · better' },
  { id: 'claude-opus-5-5', label: 'Opus · best, slow' },
] as const;

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

const KEY_STORAGE = 'drift.claudeApiKey';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key lasts for this session only.
  }
}

export interface ToolCall {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: unknown };
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Ask Claude to answer by calling `tool`; returns the tool's input. */
export async function callTool(req: ToolCall): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 32000,
        system: req.system,
        tools: [req.tool],
        // Newer models refuse a forced tool_choice; the prompt asks for the tool instead.
        messages: [{ role: 'user', content: `${req.user}\n\nAnswer only by calling the ${req.tool.name} tool.` }],
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error('Couldn’t reach the Claude API. Check your internet connection.');
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    stop_reason?: string;
    content?: { type: string; name?: string; input?: unknown; text?: string }[];
  };
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('The API key was refused. Check it in the AI settings.');
    throw new Error(`Claude API: ${msg}`);
  }
  if (body.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut off. Try fewer or shorter sections.');
  const call = body.content?.find((c) => c.type === 'tool_use' && c.name === req.tool.name);
  if (call) return call.input;
  // Fallback: the same JSON written as text instead of a tool call.
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const json = jsonIn(text);
  if (json !== undefined) return json;
  throw new Error('Claude didn’t send any music');
}

/** The outermost JSON object in a text, if it parses. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
