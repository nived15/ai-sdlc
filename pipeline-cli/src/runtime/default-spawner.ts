/**
 * `defaultSpawner()` — Tier 2 spawner-resolution helper (RFC-0012 §8.3).
 *
 * The framework dispatches every subagent through the GitHub Copilot CLI, so
 * resolution is a single branch:
 *
 *   1. **`COPILOT_SPAWN_AGENT_BIN` set?** → `CopilotHarnessAdapter` over the
 *      subprocess bridge at that path.
 *   2. **Unset?** → throw a clear error telling the operator how to fix it.
 *
 * Tier 1 (the slash command body) NEVER calls this — it dispatches subagents
 * via the host session's agent tool, which doesn't need a SubagentSpawner.
 *
 * ### Detection mechanics
 *
 * Bridge detection is a literal `process.env.COPILOT_SPAWN_AGENT_BIN` truthy
 * check. We DON'T pre-validate the bridge by executing it (that would burn a
 * Copilot request just to construct a spawner) — a broken bridge fails at the
 * first `spawn()` call with a clear error.
 *
 * `bin/copilot-spawn-agent-bridge.mjs` ships in this repo as the canonical
 * bridge; see `docs/operations/copilot-spawner.md`.
 *
 * @see RFC-0012 §8.3
 * @see ./spawners/copilot-harness.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CopilotHarnessAdapter,
  subprocessCopilotSpawnAgent,
  type CopilotHarnessAdapterOptions,
  type SubprocessCopilotSpawnAgentOptions,
} from './spawners/copilot-harness.js';
import type { SubagentSpawner } from '../types.js';

const execFileP = promisify(execFile);

/** Async predicate — returns true if `bin` is resolvable on PATH. */
export type WhichFn = (bin: string) => Promise<boolean>;

export interface DefaultSpawnerOptions {
  /**
   * Override the env read for the bridge path. Defaults to reading
   * `process.env.COPILOT_SPAWN_AGENT_BIN`. Tests inject a stub to avoid
   * mutating the real `process.env`.
   */
  env?: () => string | undefined;
  /** Forwarded to `subprocessCopilotSpawnAgent()` (tests inject a fake spawn). */
  bridge?: Omit<SubprocessCopilotSpawnAgentOptions, 'bridgeBin'>;
  /** Forwarded to the constructed `CopilotHarnessAdapter`. */
  copilot?: Omit<CopilotHarnessAdapterOptions, 'spawnAgent'>;
}

/**
 * Real `which`-style probe. Exported so callers can re-use the same detection
 * logic when they need to check for the `copilot` CLI on PATH.
 */
export const defaultWhich: WhichFn = async (bin) => {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileP(command, [bin], { timeout: 5_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
};

/** Operator-facing message when no Copilot bridge is configured. */
export const NO_COPILOT_RUNTIME_MESSAGE =
  'No GitHub Copilot runtime available — install the GitHub Copilot CLI and set ' +
  'COPILOT_SPAWN_AGENT_BIN to the path of your bridge script ' +
  '(the repo ships one at scripts/copilot-spawn-agent-bridge.mjs). ' +
  'See docs/operations/copilot-spawner.md.';

/**
 * Resolve the `SubagentSpawner` for the current environment.
 *
 * @throws when `COPILOT_SPAWN_AGENT_BIN` is not configured.
 */
export async function defaultSpawner(
  options: DefaultSpawnerOptions = {},
): Promise<SubagentSpawner> {
  const readEnv = options.env ?? (() => process.env.COPILOT_SPAWN_AGENT_BIN);

  const bridgeBin = readEnv();
  if (!bridgeBin) {
    throw new Error(NO_COPILOT_RUNTIME_MESSAGE);
  }

  const spawnAgent = subprocessCopilotSpawnAgent({ bridgeBin, ...options.bridge });
  return new CopilotHarnessAdapter({ spawnAgent, ...options.copilot });
}
