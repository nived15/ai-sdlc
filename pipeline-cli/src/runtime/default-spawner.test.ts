/**
 * `defaultSpawner()` tests — GitHub Copilot bridge resolution.
 *
 * The resolver has exactly two outcomes:
 *   1. `COPILOT_SPAWN_AGENT_BIN` set  → `CopilotHarnessAdapter`
 *   2. unset                          → throws `NO_COPILOT_RUNTIME_MESSAGE`
 *
 * Both are driven through the injectable `env` callback so the tests never
 * mutate the real `process.env` and never spawn a real Copilot CLI.
 */

import { describe, it, expect } from 'vitest';
import { defaultSpawner, defaultWhich, NO_COPILOT_RUNTIME_MESSAGE } from './default-spawner.js';
import { CopilotHarnessAdapter } from './spawners/copilot-harness.js';

describe('defaultSpawner', () => {
  it('returns a CopilotHarnessAdapter when the bridge env var is set', async () => {
    const spawner = await defaultSpawner({ env: () => '/usr/local/bin/copilot-bridge.mjs' });
    expect(spawner).toBeInstanceOf(CopilotHarnessAdapter);
  });

  it('throws an actionable error when the bridge env var is absent', async () => {
    await expect(defaultSpawner({ env: () => undefined })).rejects.toThrow(
      NO_COPILOT_RUNTIME_MESSAGE,
    );
  });

  it('treats an empty bridge path as unset', async () => {
    await expect(defaultSpawner({ env: () => '' })).rejects.toThrow(/COPILOT_SPAWN_AGENT_BIN/);
  });

  it('mentions the GitHub Copilot CLI and never a third-party runtime', async () => {
    expect(NO_COPILOT_RUNTIME_MESSAGE).toMatch(/GitHub Copilot CLI/);
    expect(NO_COPILOT_RUNTIME_MESSAGE).not.toMatch(/anthropic|claude|codex|cursor|openai/i);
  });
});

describe('defaultWhich', () => {
  it('resolves false for a binary that cannot exist on PATH', async () => {
    await expect(defaultWhich('definitely-not-a-real-binary-ai-sdlc')).resolves.toBe(false);
  });
});
