/**
 * Runner registry — manages available agent runners with auto-discovery.
 *
 * Design decision D4: Registry auto-discovers available runners from environment.
 */

import type { AgentRunner } from './types.js';
import { CopilotRunner } from './copilot.js';

export interface RegisteredRunner {
  name: string;
  runner: AgentRunner;
  /** Whether this runner is available (has required config). */
  available: boolean;
  /** Source of the runner (built-in, env, manual). */
  source: 'built-in' | 'env' | 'manual';
}

export class RunnerRegistry {
  private runners = new Map<string, RegisteredRunner>();

  /**
   * Register a runner manually.
   */
  register(name: string, runner: AgentRunner): void {
    this.runners.set(name, {
      name,
      runner,
      available: true,
      source: 'manual',
    });
  }

  /**
   * Get a runner by name.
   */
  get(name: string): AgentRunner | undefined {
    return this.runners.get(name)?.runner;
  }

  /**
   * Get the default runner. Returns the first available runner.
   */
  getDefault(): AgentRunner | undefined {
    for (const entry of this.runners.values()) {
      if (entry.available) return entry.runner;
    }
    return undefined;
  }

  /**
   * List all registered runners.
   */
  list(): RegisteredRunner[] {
    return [...this.runners.values()];
  }

  /**
   * List only available runners.
   */
  listAvailable(): RegisteredRunner[] {
    return [...this.runners.values()].filter((r) => r.available);
  }

  /**
   * Check if a runner is registered and available.
   */
  has(name: string): boolean {
    const entry = this.runners.get(name);
    return entry?.available ?? false;
  }

  /**
   * Load and register a runner from an external plugin module.
   *
   * The module must export a default export or a named `runner` export that
   * satisfies the `AgentRunner` interface (i.e. has a `run(ctx)` method).
   *
   * @param pluginPath - Absolute or resolvable path to the plugin module (e.g. `/path/to/runner.mjs`).
   * @param name - Registry name for the loaded runner (defaults to the basename of the path).
   * @throws Error when the module cannot be imported or does not export a valid AgentRunner.
   */
  async loadFromPlugin(pluginPath: string, name?: string): Promise<string> {
    let mod: unknown;
    try {
      mod = await import(pluginPath);
    } catch (err) {
      throw new Error(
        `AI_SDLC_RUNNER_PLUGIN: failed to import plugin module "${pluginPath}": ${err instanceof Error ? err.message : String(err)}.\n` +
          `Ensure the path is correct and the module is a valid ESM/CJS module.`,
        { cause: err },
      );
    }

    // Accept default export or named 'runner' export
    const exported =
      (mod as Record<string, unknown>).default ?? (mod as Record<string, unknown>).runner;

    if (!exported || typeof (exported as Record<string, unknown>).run !== 'function') {
      throw new Error(
        `AI_SDLC_RUNNER_PLUGIN: plugin module "${pluginPath}" does not export a valid AgentRunner.\n` +
          `Expected a default export (or named 'runner' export) with a \`run(ctx: AgentContext): Promise<AgentResult>\` method.\n` +
          `Got: ${JSON.stringify(Object.keys(mod as object))}`,
      );
    }

    const runnerName =
      name ??
      pluginPath
        .split('/')
        .pop()!
        .replace(/\.(m|c)?[jt]s$/, '');
    this.runners.set(runnerName, {
      name: runnerName,
      runner: exported as AgentRunner,
      available: true,
      source: 'manual',
    });
    return runnerName;
  }

  /**
   * Auto-discover runners and register them.
   *
   * The GitHub Copilot CLI runner is always registered as the built-in
   * default. Adopters can supply additional runners through the
   * `AI_SDLC_RUNNER_PLUGIN` seam (see `resolveRunner`) or `register()`.
   */
  discoverFromEnv(_env: Record<string, string | undefined> = process.env): void {
    if (!this.runners.has('copilot')) {
      this.runners.set('copilot', {
        name: 'copilot',
        runner: new CopilotRunner(),
        available: true,
        source: 'built-in',
      });
    }
  }
}

/**
 * Create a runner registry with auto-discovery.
 */
export function createRunnerRegistry(env?: Record<string, string | undefined>): RunnerRegistry {
  const registry = new RunnerRegistry();
  registry.discoverFromEnv(env);
  return registry;
}

/**
 * Resolve the agent runner to use, applying the full precedence chain:
 *
 *   1. `injectedRunner` — programmatic override (options.runner from caller / tests)
 *   2. `runnerName` — explicit `--runner <name>` flag (must already be registered after discoverFromEnv)
 *   3. `AI_SDLC_RUNNER_PLUGIN` env — path to a dynamic plugin module (loaded + registered)
 *   4. CopilotRunner (hard-coded default)
 *
 * IMPORTANT — plugin-registered runners do NOT auto-win (AISDLC-529 code review).
 * `AI_SDLC_RUNNER_PLUGIN` is an explicit opt-in seam; an adopter selects any other
 * registered runner by name via `--runner <name>`. The default stays CopilotRunner
 * so behaviour never changes because of ambient environment state.
 *
 * This function is async because step 3 may dynamically import a module.
 *
 * @throws Error when `runnerName` is provided but not registered in the registry.
 * @throws Error when `AI_SDLC_RUNNER_PLUGIN` points to an invalid module.
 */
export async function resolveRunner(
  registry: RunnerRegistry,
  opts: {
    injectedRunner?: AgentRunner;
    runnerName?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<AgentRunner> {
  const env = opts.env ?? process.env;

  // 1. Programmatic injection (options.runner / test override) — always wins
  if (opts.injectedRunner) {
    return opts.injectedRunner;
  }

  // 2. Explicit --runner <name> flag
  if (opts.runnerName) {
    const named = registry.get(opts.runnerName);
    if (!named) {
      const available = registry.listAvailable().map((r) => r.name);
      throw new Error(
        `--runner "${opts.runnerName}" is not registered. ` +
          `Available runners: ${available.length > 0 ? available.join(', ') : '(none)'}.\n` +
          `Tip: set AI_SDLC_RUNNER_PLUGIN=/path/to/runner.mjs to load a custom runner first.`,
      );
    }
    return named;
  }

  // 3. AI_SDLC_RUNNER_PLUGIN env — dynamically load + register, then return
  const pluginPath = env.AI_SDLC_RUNNER_PLUGIN;
  if (pluginPath) {
    const registeredName = await registry.loadFromPlugin(pluginPath);
    const pluginRunner = registry.get(registeredName);
    // loadFromPlugin throws on invalid module, so pluginRunner is guaranteed to exist here
    return pluginRunner!;
  }

  // 4. CopilotRunner default (always in registry after discoverFromEnv).
  // Plugin-registered runners are intentionally NOT auto-selected here — an
  // adopter selects one explicitly via `--runner <name>` (AISDLC-529 review).
  return registry.get('copilot') ?? new CopilotRunner();
}
