import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  it('creates a session with a unique id', () => {
    const s = mgr.create({ developer: 'alice', tool: 'copilot' });
    expect(s.sessionId).toBeTruthy();
    expect(s.developer).toBe('alice');
    expect(s.tool).toBe('copilot');
    expect(s.active).toBe(true);
    expect(s.linkedIssue).toBeNull();
    expect(s.accumulatedCost.totalCostUsd).toBe(0);
  });

  it('retrieves session by id', () => {
    const s = mgr.create({ developer: 'bob', tool: 'copilot' });
    expect(mgr.get(s.sessionId)).toBe(s);
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('returns the most recent active session', () => {
    const s1 = mgr.create({ developer: 'a', tool: 'vscode' });
    mgr.end(s1.sessionId);
    const s2 = mgr.create({ developer: 'b', tool: 'copilot' });
    expect(mgr.getActive()?.sessionId).toBe(s2.sessionId);
  });

  it('returns undefined when no active sessions', () => {
    expect(mgr.getActive()).toBeUndefined();
    const s = mgr.create({ developer: 'a', tool: 'other' });
    mgr.end(s.sessionId);
    expect(mgr.getActive()).toBeUndefined();
  });

  it('accumulates usage entries', () => {
    const s = mgr.create({ developer: 'a', tool: 'copilot' });
    mgr.addUsage(s.sessionId, {
      model: 'reasoning',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
    });
    mgr.addUsage(s.sessionId, {
      model: 'reasoning',
      inputTokens: 2000,
      outputTokens: 1000,
      costUsd: 0.1,
    });
    mgr.addUsage(s.sessionId, {
      model: 'gpt-5-mini',
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.01,
    });

    expect(s.accumulatedCost.totalInputTokens).toBe(3500);
    expect(s.accumulatedCost.totalOutputTokens).toBe(1700);
    expect(s.accumulatedCost.totalCostUsd).toBeCloseTo(0.16);
    expect(s.accumulatedCost.byModel['reasoning'].inputTokens).toBe(3000);
    expect(s.accumulatedCost.byModel['gpt-5-mini'].costUsd).toBeCloseTo(0.01);
  });

  it('ignores usage for nonexistent session', () => {
    // Should not throw
    mgr.addUsage('no-such-id', { model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0 });
  });

  it('links an issue', () => {
    const s = mgr.create({ developer: 'a', tool: 'copilot' });
    mgr.linkIssue(s.sessionId, 42, 'branch');
    expect(s.linkedIssue).toBe(42);
    expect(s.linkMethod).toBe('branch');
  });

  it('ends a session and marks it inactive', () => {
    const s = mgr.create({ developer: 'a', tool: 'copilot' });
    const ended = mgr.end(s.sessionId);
    expect(ended?.active).toBe(false);
    expect(mgr.getActive()).toBeUndefined();
  });

  it('returns undefined when ending nonexistent session', () => {
    expect(mgr.end('nonexistent')).toBeUndefined();
  });

  it('handles multiple sessions', () => {
    const s1 = mgr.create({ developer: 'a', tool: 'copilot' });
    const s2 = mgr.create({ developer: 'b', tool: 'copilot' });
    expect(mgr.get(s1.sessionId)?.developer).toBe('a');
    expect(mgr.get(s2.sessionId)?.developer).toBe('b');
  });
});
