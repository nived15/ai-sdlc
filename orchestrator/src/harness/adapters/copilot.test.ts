import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from './copilot.js';

describe('CopilotAdapter', () => {
  it('declares the copilot harness name', () => {
    expect(new CopilotAdapter().name).toBe('copilot');
  });

  it('requires the `copilot` binary and probes --version', () => {
    const adapter = new CopilotAdapter();
    expect(adapter.requires.binary).toBe('copilot');
    expect(adapter.requires.versionProbe.args).toEqual(['--version']);
    expect(adapter.requires.versionProbe.parse('GitHub Copilot CLI 1.2.3')).toBe('1.2.3');
  });

  it('derives a one-way account id from GH_TOKEN', async () => {
    const adapter = new CopilotAdapter({
      env: { GH_TOKEN: 'ghp-test-token' } as NodeJS.ProcessEnv,
    });
    const id = await adapter.getAccountId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain('ghp-test-token');
  });

  it('falls back to GITHUB_TOKEN', async () => {
    const adapter = new CopilotAdapter({
      env: { GITHUB_TOKEN: 'ghp-other' } as NodeJS.ProcessEnv,
    });
    await expect(adapter.getAccountId()).resolves.toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns null when no GitHub token is in scope', async () => {
    const adapter = new CopilotAdapter({ env: {} as NodeJS.ProcessEnv });
    await expect(adapter.getAccountId()).resolves.toBeNull();
  });

  it('caches the availability probe', async () => {
    let calls = 0;
    const adapter = new CopilotAdapter({
      probe: async () => {
        calls++;
        return { available: true, installedVersion: '1.0.0' };
      },
    });
    await adapter.isAvailable();
    await adapter.isAvailable();
    expect(calls).toBe(1);
  });

  it('delegates invoke to the injected dep', async () => {
    const adapter = new CopilotAdapter({
      invoke: async () => ({
        status: 'success' as const,
        exitCode: 0,
        costUsd: 0,
        inputTokens: 1,
        outputTokens: 2,
        artifactPaths: [],
      }),
    });
    const result = await adapter.invoke({
      prompt: 'p',
      cwd: '/tmp',
      model: 'gpt-5',
      artifactsDir: '/tmp/a',
    });
    expect(result.status).toBe('success');
  });

  it('throws a clear error when invoke is not wired', async () => {
    const adapter = new CopilotAdapter();
    await expect(
      adapter.invoke({ prompt: 'p', cwd: '/tmp', model: 'gpt-5', artifactsDir: '/tmp/a' }),
    ).rejects.toThrow(/not wired into dispatch/);
  });

  it('reports available models', async () => {
    await expect(new CopilotAdapter().availableModels()).resolves.toContain('gpt-5');
  });
});
