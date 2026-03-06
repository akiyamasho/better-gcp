import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import type { AiEditRequest, AiEditResult } from './types';

const execFileAsync = promisify(execFile);

/** Run a command and return stdout, with better error messages. */
function runCli(cmd: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `CLI exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    // 120s timeout
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('AI CLI timed out after 120 seconds.'));
    }, 120_000);

    proc.on('close', () => clearTimeout(timer));
  });
}

/** Cached CLI detection result. */
let cachedCli: { name: 'claude' | 'codex'; path: string } | null = null;

/** Build a clean env for spawning CLI tools. */
function cleanEnv(): Record<string, string> {
  const home = os.homedir();
  const extra = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
  ];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Strip CLAUDECODE env vars so claude CLI doesn't think it's nested
    if (v != null && !k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE')) {
      env[k] = v;
    }
  }
  env.PATH = [process.env.PATH, ...extra].filter(Boolean).join(':');
  return env;
}

/** Check if any AI CLI is available. Returns the name or null. */
export async function checkAiCliAvailable(): Promise<string | null> {
  try {
    const cli = await detectCli();
    return cli.name;
  } catch {
    return null;
  }
}

/** Detect which AI CLI is available. Prefer claude, fall back to codex. */
async function detectCli(): Promise<{ name: 'claude' | 'codex'; path: string }> {
  if (cachedCli) return cachedCli;

  const env = cleanEnv();

  for (const cli of [
    { name: 'claude' as const, args: ['--version'] },
    { name: 'codex' as const, args: ['--version'] },
  ]) {
    try {
      await execFileAsync(cli.name, cli.args, { timeout: 5000, env });
      cachedCli = { name: cli.name, path: cli.name };
      return cachedCli;
    } catch {
      // not found — try next
    }
  }

  throw new Error(
    'No AI CLI found. Install Claude Code (claude) or OpenAI Codex CLI (codex) and make sure it is on your PATH.',
  );
}

function buildPrompt(req: AiEditRequest): string {
  let prompt = `You are a SQL assistant for Google BigQuery.\n\n`;
  if (req.tableContext) {
    prompt += `Available tables (use these EXACT fully-qualified names with backticks in your query):\n${req.tableContext}\n\n`;
  }
  if (req.currentQuery) {
    prompt += `Current SQL query:\n\`\`\`sql\n${req.currentQuery}\n\`\`\`\n\n`;
  }
  prompt += `User instruction: ${req.instruction}\n\n`;
  prompt += `IMPORTANT: Always use fully-qualified table names in backticks like \`project.dataset.table\`. Match table and column names EXACTLY as listed above.\nReturn ONLY the SQL query. No explanation, no markdown fencing, just raw SQL.`;
  return prompt;
}

function extractSql(raw: string): string {
  let text = raw.trim();
  // Strip markdown code fences if the CLI returned them despite instructions.
  const fenceMatch = text.match(/```(?:sql)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text;
}

export async function aiEditQuery(
  req: AiEditRequest,
  onChunk?: (chunk: string) => void,
): Promise<AiEditResult> {
  const cli = await detectCli();
  const prompt = buildPrompt(req);

  const args =
    cli.name === 'claude'
      ? ['-p', prompt] // claude -p "prompt" (print mode)
      : ['-q', prompt]; // codex -q "prompt" (quiet mode)

  const stdout = await new Promise<string>((resolve, reject) => {
    const proc = spawn(cli.path, args, { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';

    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString();
      out += chunk;
      onChunk?.(chunk);
    });
    proc.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `CLI exited with code ${code}`));
      } else {
        resolve(out);
      }
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('AI CLI timed out after 120 seconds.'));
    }, 120_000);
    proc.on('close', () => clearTimeout(timer));
  });

  const updatedQuery = extractSql(stdout);
  if (!updatedQuery) {
    throw new Error('AI returned an empty response. Try rephrasing your instruction.');
  }

  return { updatedQuery, cliUsed: cli.name };
}
