/**
 * Phase 1.5 (RFC-0041 OQ-4 / AISDLC-377.2) — `copilot -p` session-resume
 * helpers for the `copilot-p-shell` Worker kind.
 *
 * The OQ-4 resolution mandates context-preserving resumption: instead of
 * re-emitting a fresh manifest (which would force the Worker to re-read the
 * task body, re-explore the codebase, etc.), the supervisor re-spawns the
 * SAME `copilot -p` session with `--resume <session-id>` so the prior
 * conversation transcript carries over. This module ships the primitives
 * the supervisor (Phase 2 / AISDLC-377.3) will compose.
 *
 * Three primitives:
 *
 *   - `buildCopilotInitialArgv(opts)` — argv for the first-attempt spawn,
 *     including `--session-id <uuid>` so the supervisor knows the ID up
 *     front (rather than parsing it back out of the JSON envelope at
 *     completion).
 *   - `buildCopilotResumeArgv(opts)` — argv for the resume spawn, including
 *     `--resume <uuid>` + the conductor feedback as the positional prompt.
 *   - `extractSessionIdFromCopilotOutput(json)` — pull the session ID out of
 *     the `--output-format json` envelope as a defense-in-depth fallback
 *     when the supervisor wants to double-check the spawn-time ID matches
 *     what the CLI actually used.
 *
 * The supervisor (when AISDLC-377.3 lands) calls these from a small spawn
 * loop that resembles:
 *
 *   const sessionId = crypto.randomUUID();
 *   const argv1 = buildCopilotInitialArgv({ sessionId, prompt, agent: 'developer' });
 *   spawn('copilot', argv1, { env: { ...env, COPILOT_CLI_SESSION: undefined } });
 *   // wait for verdict.outcome === 'iterate-needed' + resume-signal
 *   const argv2 = buildCopilotResumeArgv({ sessionId, feedback });
 *   spawn('copilot', argv2, { env: { ...env, COPILOT_CLI_SESSION: undefined } });
 *
 * All argv values are passed as separate entries (no shell expansion); the
 * caller is responsible for the spawn options (`cwd`, `env`).
 */

import { randomUUID } from 'node:crypto';

/** Default subagent the supervisor invokes (`ai-sdlc-plugin/agents/developer.md`). */
export const DEFAULT_RESUME_AGENT = 'developer';

/** Options for `buildCopilotInitialArgv`. */
export interface BuildCopilotInitialArgvOpts {
  /**
   * Stable session identifier for the spawn. Pass an explicit UUID when the
   * supervisor wants to record the ID before the spawn returns; pass
   * `undefined` to let this helper mint a fresh UUID (returned alongside
   * the argv).
   */
  sessionId?: string;
  /** Positional prompt passed to `copilot -p` (last argv entry). */
  prompt: string;
  /** Agent name (`--agent <agent>`). Defaults to `developer`. */
  agent?: string;
  /** Optional model override (`--model <model>`). */
  model?: string;
  /** Extra argv appended BEFORE the positional prompt. */
  extraArgs?: readonly string[];
}

/**
 * Build the initial-spawn argv for a `copilot -p` Worker. Returns
 * `{argv, sessionId}` — `sessionId` is the supervisor's local correlation
 * key, recorded on its inflight tracking alongside the PID.
 *
 * The GitHub Copilot CLI mints its own session identifier and reports it in
 * the JSON envelope, so the supervisor reconciles the two by calling
 * `extractSessionIdFromCopilotOutput()` on the first-attempt output and
 * using THAT value for `--resume`. The locally-minted id is what correlates
 * the spawn with board artifacts (manifest, heartbeat, verdict) before the
 * CLI has produced any output.
 *
 * Argv shape:
 *   --allow-all-tools
 *   --no-color
 *   --log-level error
 *   --agent <agent>
 *   [--model <model>]
 *   [...extraArgs]
 *   -p <prompt>
 *
 * `--allow-all-tools` is required for headless operation: the Worker runs
 * unattended in an isolated worktree, so there is no operator to approve
 * individual tool calls.
 */
export function buildCopilotInitialArgv(opts: BuildCopilotInitialArgvOpts): {
  argv: string[];
  sessionId: string;
} {
  const sessionId = opts.sessionId ?? randomUUID();
  const agent = opts.agent ?? DEFAULT_RESUME_AGENT;
  const modelArgv = opts.model ? ['--model', opts.model] : [];
  const argv = [
    '--allow-all-tools',
    '--no-color',
    '--log-level',
    'error',
    '--agent',
    agent,
    ...modelArgv,
    ...(opts.extraArgs ?? []),
    '-p',
    opts.prompt,
  ];
  return { argv, sessionId };
}

/** Options for `buildCopilotResumeArgv`. */
export interface BuildCopilotResumeArgvOpts {
  /**
   * Copilot CLI session ID recovered from the first-attempt output via
   * `extractSessionIdFromCopilotOutput()`. REQUIRED.
   */
  sessionId: string;
  /** Conductor-authored feedback prepended to the resumed conversation. */
  feedback: string;
  /** Optional extra argv (e.g. `--model` override on resume). */
  extraArgs?: readonly string[];
}

/**
 * Build the resume-spawn argv for a `copilot -p` Worker. The `--resume <id>`
 * flag tells the Copilot CLI to load the prior conversation transcript; the
 * `-p <feedback>` prompt is treated as the operator's next message in that
 * conversation.
 *
 * Argv shape:
 *   --allow-all-tools
 *   --no-color
 *   --log-level error
 *   --resume <session-id>
 *   [...extraArgs]
 *   -p <feedback>
 *
 * Note: `--agent` is NOT included on resume — the prior session already
 * established the agent, and re-passing it is a no-op (and confusingly
 * implies the agent could change mid-conversation). `--model` similarly is
 * pinned by the prior session unless the caller explicitly overrides via
 * `extraArgs`.
 */
export function buildCopilotResumeArgv(opts: BuildCopilotResumeArgvOpts): string[] {
  return [
    '--allow-all-tools',
    '--no-color',
    '--log-level',
    'error',
    '--resume',
    opts.sessionId,
    ...(opts.extraArgs ?? []),
    '-p',
    opts.feedback,
  ];
}

/**
 * Extract the session ID from a parsed Copilot CLI JSON envelope. This is
 * the supervisor's source of truth for the `--resume <id>` value, because
 * the CLI mints the session identifier itself.
 *
 * The envelope carries the session ID at top-level as `session_id`
 * (snake_case). We accept both `session_id` AND `sessionId` (camel-case)
 * defensively. Returns `undefined` when the field is absent or the envelope
 * is malformed — the supervisor then falls back to a fresh spawn rather
 * than issuing a `--resume` it cannot satisfy.
 */
export function extractSessionIdFromCopilotOutput(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  const fromSnake = obj['session_id'];
  if (typeof fromSnake === 'string' && fromSnake.length > 0) return fromSnake;
  const fromCamel = obj['sessionId'];
  if (typeof fromCamel === 'string' && fromCamel.length > 0) return fromCamel;
  return undefined;
}
