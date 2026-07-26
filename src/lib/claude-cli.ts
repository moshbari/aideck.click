import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

/**
 * All of AIDeck's writing (slide copy, speaker scripts, image prompts) runs on
 * the owner's Claude subscription through the bundled `claude` CLI — the same
 * arrangement as WiseKid, SAASBuyers and the Reality Check apps.
 *
 * If CLAUDE_CODE_OAUTH_TOKEN isn't set, we fall back to the Anthropic API with
 * ANTHROPIC_API_KEY so nothing breaks while the token is being rotated.
 */

const CLAUDE_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'claude');

// `sonnet` / `opus` / `haiku` aliases are resolved by the CLI itself
const DEFAULT_CLI_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
// Only used on the API fallback path
const DEFAULT_API_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

export function usingSubscription(): boolean {
  return Boolean(sanitizeToken(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}

function sanitizeToken(token: string | undefined): string {
  return String(token || '').replace(/\s+/g, '');
}

// Each CLI run gets its own throwaway HOME so concurrent generations never
// collide on the CLI's config files.
function makeHome(): string {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-home-'));
  } catch {
    return os.tmpdir();
  }
}

function cleanHome(dir: string): void {
  if (!dir || dir === os.tmpdir()) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/** Pull a JSON object out of a model response (handles ```json fences and stray prose). */
export function extractJson(text: string): any {
  let raw: string | null = null;

  const tagged = String(text).match(/<json>([\s\S]*?)<\/json>/i);
  if (tagged) raw = tagged[1].trim();

  if (!raw) {
    const fenced = String(text).match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenced) raw = fenced[1].trim();
  }

  if (!raw) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) raw = text.slice(first, last + 1);
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Run one `claude -p` pass on the owner's subscription. */
function runClaudeCli(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // IS_SANDBOX lets the bundled CLI run as root inside the Railway container.
    const HOME = makeHome();
    const env = {
      ...process.env,
      HOME,
      IS_SANDBOX: '1',
      CLAUDE_CODE_OAUTH_TOKEN: sanitizeToken(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    };
    delete (env as Record<string, unknown>).ANTHROPIC_API_KEY;

    const args = [
      '-p',
      '--model', DEFAULT_CLI_MODEL,
      '--output-format', 'text',
      // Pure writing task — no tools needed, and skipping them keeps it fast
      '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch',
    ];

    let child: ReturnType<typeof spawn>;
    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn: (v: any) => void, value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      cleanHome(HOME);
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, new Error('Claude took too long to write this deck — please try again')),
      timeoutMs
    );

    try {
      child = spawn(CLAUDE_BIN, args, { env, cwd: os.tmpdir() });
    } catch {
      return finish(reject, new Error("Couldn't start the Claude CLI on the server"));
    }

    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { err += d.toString(); });

    child.on('error', (e: NodeJS.ErrnoException) => {
      finish(
        reject,
        new Error(
          e.code === 'ENOENT'
            ? "The Claude CLI isn't installed on the server"
            : `Claude CLI error: ${e.message}`
        )
      );
    });

    child.on('close', () => {
      const blob = `${out} ${err}`.toLowerCase();
      if (!out.trim() && /invalid bearer token|failed to authenticate|unauthorized|\b401\b|oauth/.test(blob)) {
        return finish(
          reject,
          new Error(
            'The app’s Claude subscription token was rejected — re-run `claude setup-token` and update CLAUDE_CODE_OAUTH_TOKEN'
          )
        );
      }
      if (!out.trim()) {
        return finish(reject, new Error(err.trim().slice(0, 200) || 'Claude returned an empty response'));
      }
      finish(resolve, out);
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/** API fallback — streamed so big decks don't trip the HTTP timeout. */
async function runClaudeApi(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No Claude plan connected — set CLAUDE_CODE_OAUTH_TOKEN (subscription) or ANTHROPIC_API_KEY'
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const stream = anthropic.messages.stream({
    model: DEFAULT_API_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Response was truncated — try fewer slides or less time per slide');
  }

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as any).text)
    .join('');
}

/**
 * Ask Claude for a JSON object. Uses the owner's subscription when a token is
 * configured, otherwise falls back to the API key.
 */
export async function askClaudeForJson(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<any> {
  const { maxTokens = 32000, timeoutMs = 300000 } = opts;

  // The CLI has no separate system-prompt channel in -p mode, so the
  // instructions and the user's topic go down as one prompt.
  const base = `${systemPrompt}\n\n---\n\nTHE USER'S REQUEST:\n${userPrompt}`;

  // Two attempts — the second one nags harder for clean JSON. With a council of
  // agents there are more chances for one of them to wrap output in prose.
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const combined =
      attempt === 0
        ? base
        : `${base}\n\nIMPORTANT: return ONLY the complete JSON object wrapped in <json></json> tags. No explanation, no markdown.`;

    const raw = usingSubscription()
      ? await runClaudeCli(combined, timeoutMs)
      : await runClaudeApi(combined, maxTokens);

    lastRaw = raw;
    const parsed = extractJson(raw);
    if (parsed) return parsed;
  }

  throw new Error(`Failed to parse Claude response as JSON: ${lastRaw.trim().substring(0, 200)}`);
}
