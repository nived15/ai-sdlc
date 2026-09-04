/**
 * CopilotAdapter — wraps the GitHub Copilot CLI behind the HarnessAdapter contract.
 *
 * The adapter declares the capabilities, binary requirement, and account-id
 * derivation the orchestrator needs at pipeline-load time. End-to-end dispatch
 * against a fixture worktree is wired through the dispatcher integration; tests
 * inject `deps.invoke`.
 */

import { createHash } from 'node:crypto';
import { probeVersion } from '../version-probe.js';
import type {
  HarnessAdapter,
  HarnessAvailability,
  HarnessCapabilities,
  HarnessEvent,
  HarnessInput,
  HarnessName,
  HarnessRequires,
  HarnessResult,
} from '../types.js';

const DEFAULT_AVAILABLE_MODELS = ['gpt-5', 'gpt-5-mini'];

export interface CopilotAdapterDeps {
  env?: NodeJS.ProcessEnv;
  invoke?: (input: HarnessInput, onEvent?: (e: HarnessEvent) => void) => Promise<HarnessResult>;
  probe?: () => Promise<HarnessAvailability>;
}

export class CopilotAdapter implements HarnessAdapter {
  readonly name: HarnessName = 'copilot';

  readonly capabilities: HarnessCapabilities = {
    freshContext: true,
    customTools: true,
    streaming: true,
    worktreeAwareCwd: true,
    skills: true,
    artifactWrites: true,
    maxContextTokens: 200_000,
  };

  readonly requires: HarnessRequires = {
    binary: 'copilot',
    versionRange: '>=0.1.0',
    versionProbe: {
      args: ['--version'],
      parse: (stdout) => stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '',
    },
  };

  private cachedAvailability: HarnessAvailability | null = null;

  constructor(private readonly deps: CopilotAdapterDeps = {}) {}

  async getAccountId(): Promise<string | null> {
    const env = this.deps.env ?? process.env;
    const tokenSources = [env.GH_TOKEN, env.GITHUB_TOKEN];
    for (const source of tokenSources) {
      if (source && source.length > 0) {
        return createHash('sha256').update(`copilot:${source}`).digest('hex').slice(0, 16);
      }
    }
    return null;
  }

  async isAvailable(): Promise<HarnessAvailability> {
    if (this.cachedAvailability) return this.cachedAvailability;
    const result = this.deps.probe ? await this.deps.probe() : await probeVersion(this.requires);
    this.cachedAvailability = result;
    return result;
  }

  async invoke(input: HarnessInput, onEvent?: (e: HarnessEvent) => void): Promise<HarnessResult> {
    if (this.deps.invoke) return this.deps.invoke(input, onEvent);
    throw new Error(
      'CopilotAdapter.invoke is not wired into dispatch yet. ' +
        'Tests should inject deps.invoke; production dispatch goes through ' +
        'CopilotHarnessAdapter in @ai-sdlc/pipeline-cli.',
    );
  }

  async availableModels(): Promise<string[]> {
    return DEFAULT_AVAILABLE_MODELS;
  }
}
