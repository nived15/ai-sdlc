#!/usr/bin/env node
/**
 * copilot-spawn-agent-bridge.mjs — canonical COPILOT_SPAWN_AGENT_BIN bridge
 * for `ai-sdlc-pipeline execute --spawner copilot`.
 *
 * ## Wire protocol
 *
 * The adapter in `pipeline-cli/src/runtime/spawners/copilot-harness.ts`
 * (`subprocessCopilotSpawnAgent`) spawns this script with no positional args
 * and communicates over stdin/stdout:
 *
 *   1. The adapter writes a single JSON line to stdin:
 *        { agentType, systemPrompt, userPrompt, cwd, timeoutMs }
 *   2. This bridge reads that line, invokes `copilot -p` with the correct
 *      role-specific tool permissions (see below), captures output, and
 *      writes a single JSON line to stdout:
 *        { output: string, parsed?: unknown }
 *   3. This bridge exits 0 on success; non-zero exits surface stderr as the
 *      SubagentResult error field.
 *
 * ## Role-specific permissions
 *
 *   - developer: `--allow-all-tools` — the developer edits the worktree,
 *     runs the build/test suite, commits, and pushes.
 *   - reviewers: `--deny-tool write --deny-tool shell(git push)` — reviewers
 *     read the diff and return a verdict; they must never mutate the repo.
 *
 * Reviewers still need read access, so the bridge does NOT pass
 * `--allow-all-tools` for them; it allows the read-only tool surface
 * explicitly and denies everything that writes.
 *
 * ## Per-field overrides
 *
 * The request envelope's optional fields are honoured if present:
 *   - `extraArgs`: optional model flags inserted after the base flags. Only
 *     `--model`/`-m` is forwarded; tool-permission and directory overrides
 *     are deliberately stripped so a caller cannot relax the sandbox.
 *
 * ## Usage
 *
 *   export COPILOT_SPAWN_AGENT_BIN="$(pwd)/scripts/copilot-spawn-agent-bridge.mjs"
 *   node ./pipeline-cli/bin/ai-sdlc-pipeline.mjs execute AISDLC-NNN --run --spawner copilot
 *
 * Run with: node scripts/copilot-spawn-agent-bridge.mjs  (reads stdin, writes stdout)
 */

import { spawn } from 'node:child_process';

/** Reads all of stdin and resolves with the complete string. */
function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

/**
 * Filter caller-supplied extra args down to the safe subset.
 *
 * SECURITY: only model selection crosses the boundary. Allowing
 * `--allow-tool` / `--allow-all-tools` / `--add-dir` here would let a
 * prompt-injected reviewer escalate itself to write access.
 *
 * @param {string[]} extraArgs
 * @returns {string[]}
 */
export function safeExtraArgs(extraArgs = []) {
  const out = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    if (typeof arg !== 'string') continue;
    if (arg === '-m' || arg === '--model') {
      const value = extraArgs[i + 1];
      if (typeof value === 'string') {
        out.push(arg, value);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--model=')) {
      out.push(arg);
    }
  }
  return out;
}

/**
 * Build the `copilot` argv for a given agent type.
 *
 * @param {string} agentType
 * @param {string[]} extraArgs
 * @returns {string[]}
 */
export function buildArgs(agentType, extraArgs = []) {
  const base = ['--no-color', '--log-level', 'error'];
  const permissions =
    agentType === 'developer'
      ? ['--allow-all-tools']
      : [
          // Read-only reviewer surface: allow inspection, deny every mutation.
          '--allow-tool',
          'read',
          '--allow-tool',
          'search',
          '--deny-tool',
          'write',
          '--deny-tool',
          'edit',
          '--deny-tool',
          'shell',
        ];
  return [...base, ...permissions, ...safeExtraArgs(extraArgs), '-p'];
}

/**
 * Invoke `copilot -p` and return its stdout.
 *
 * @param {string} promptText - Combined prompt (system + user) to pass.
 * @param {string} cwd - Working directory for the copilot process.
 * @param {number} timeoutMs - Process kill timeout in milliseconds.
 * @param {string[]} extraArgs - Additional CLI flags (optional overrides).
 * @param {string} agentType - AI-SDLC subagent type being dispatched.
 * @returns {Promise<string>} stdout from copilot.
 */
function runCopilot(promptText, cwd, timeoutMs, extraArgs = [], agentType = 'developer') {
  return new Promise((resolve, reject) => {
    const args = [...buildArgs(agentType, extraArgs), promptText];

    let child;
    try {
      child = spawn('copilot', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`failed to spawn copilot: ${String(err)}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      settle(() => reject(new Error(`copilot -p timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      settle(() => reject(new Error(`copilot -p errored: ${String(err)}`)));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        settle(() =>
          reject(new Error(`copilot -p exited ${code ?? 'null'}: ${stderr.trim() || 'no stderr'}`)),
        );
        return;
      }
      if (!stdout.trim()) {
        settle(() =>
          reject(
            new Error(
              `copilot -p exited 0 with empty stdout for ${agentType}; expected agent output. ` +
                'Check GitHub Copilot CLI auth (`copilot` then `/login`), prompt handling, and output mode.',
            ),
          ),
        );
        return;
      }
      settle(() => resolve(stdout));
    });
  });
}

/**
 * Best-effort JSON parse. Returns the parsed value or undefined.
 * Tolerates markdown-fenced JSON blocks that agents sometimes emit.
 *
 * @param {string} text
 * @returns {unknown | undefined}
 */
export function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function main() {
  let rawInput;
  try {
    rawInput = await readStdin();
  } catch (err) {
    process.stderr.write(`copilot-spawn-agent-bridge: failed to read stdin: ${String(err)}\n`);
    process.exit(1);
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    process.stderr.write('copilot-spawn-agent-bridge: empty stdin — expected JSON-line request\n');
    process.exit(1);
  }

  /** @type {{ agentType: string, systemPrompt: string, userPrompt: string, cwd: string, timeoutMs: number, extraArgs?: string[] }} */
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (err) {
    process.stderr.write(`copilot-spawn-agent-bridge: stdin is not valid JSON: ${String(err)}\n`);
    process.exit(1);
  }

  const {
    agentType = 'developer',
    systemPrompt = '',
    userPrompt = '',
    cwd = process.cwd(),
    timeoutMs = 1800000,
    extraArgs = [],
  } = request;

  // Compose a single prompt string: system context followed by user prompt.
  const promptText = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

  let output;
  try {
    output = await runCopilot(promptText, cwd, timeoutMs, extraArgs, agentType);
  } catch (err) {
    process.stderr.write(`copilot-spawn-agent-bridge: ${String(err)}\n`);
    process.exit(1);
  }

  const parsed = tryParseJson(output);

  /** @type {{ output: string, parsed?: unknown }} */
  const response = parsed !== undefined ? { output, parsed } : { output };

  process.stdout.write(JSON.stringify(response) + '\n');
}

// Only run the CLI body when invoked directly, so the pure helpers above are
// importable from tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    process.stderr.write(`copilot-spawn-agent-bridge: unhandled error: ${String(err)}\n`);
    process.exit(1);
  });
}
