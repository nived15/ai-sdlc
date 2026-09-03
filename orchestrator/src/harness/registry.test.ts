import { describe, it, expect } from 'vitest';
import { HarnessRegistry, UnknownHarnessError } from './registry.js';
import { CopilotAdapter } from './adapters/copilot.js';
import { createDefaultHarnessRegistry } from './index.js';

describe('HarnessRegistry', () => {
  it('register + get round-trips', () => {
    const reg = new HarnessRegistry();
    const adapter = new CopilotAdapter();
    reg.register(adapter);
    expect(reg.get('copilot')).toBe(adapter);
  });

  it('has() reflects registration state', () => {
    const reg = new HarnessRegistry();
    expect(reg.has('copilot')).toBe(false);
    reg.register(new CopilotAdapter());
    expect(reg.has('copilot')).toBe(true);
  });

  it('get throws UnknownHarnessError for unregistered names', () => {
    const reg = new HarnessRegistry();
    expect(() => reg.get('mystery-harness')).toThrow(UnknownHarnessError);
  });

  it('list returns registered harness names', () => {
    const reg = new HarnessRegistry();
    reg.register(new CopilotAdapter());
    expect(reg.list()).toEqual(['copilot']);
  });
});

describe('createDefaultHarnessRegistry', () => {
  it('ships with the GitHub Copilot adapter', () => {
    const reg = createDefaultHarnessRegistry();
    expect(reg.has('copilot')).toBe(true);
    expect(reg.list()).toEqual(['copilot']);
  });
});
