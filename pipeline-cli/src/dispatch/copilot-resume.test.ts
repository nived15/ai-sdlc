/**
 * Tests for the `copilot -p` session-resume helpers (RFC-0041 OQ-4 /
 * AISDLC-377.2). These are the primitives the supervisor (Phase 2 /
 * AISDLC-377.3) will compose into its actual subprocess spawn loop.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCopilotInitialArgv,
  buildCopilotResumeArgv,
  DEFAULT_RESUME_AGENT,
  extractSessionIdFromCopilotOutput,
} from './copilot-resume.js';

describe('buildCopilotInitialArgv', () => {
  it('includes --allow-all-tools, --no-color, --log-level, --agent and -p <prompt>', () => {
    const { argv, sessionId } = buildCopilotInitialArgv({
      sessionId: 'abc-123-uuid',
      prompt: 'implement task AISDLC-X',
    });
    expect(sessionId).toBe('abc-123-uuid');
    expect(argv).toEqual([
      '--allow-all-tools',
      '--no-color',
      '--log-level',
      'error',
      '--agent',
      DEFAULT_RESUME_AGENT,
      '-p',
      'implement task AISDLC-X',
    ]);
  });

  it('mints a fresh UUID when no sessionId is provided', () => {
    const { sessionId } = buildCopilotInitialArgv({
      prompt: 'p',
    });
    // RFC-4122 v4 UUIDs look like 8-4-4-4-12 hex chars.
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('threads --model when provided', () => {
    const { argv } = buildCopilotInitialArgv({
      sessionId: 'sid',
      prompt: 'p',
      model: 'gpt-5',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-5');
    // --model must appear BEFORE the trailing `-p <prompt>` pair.
    expect(argv[argv.length - 1]).toBe('p');
    expect(argv[argv.length - 2]).toBe('-p');
  });

  it('threads --agent override', () => {
    const { argv } = buildCopilotInitialArgv({
      sessionId: 'sid',
      prompt: 'p',
      agent: 'test-reviewer',
    });
    expect(argv).toContain('--agent');
    const agentIdx = argv.indexOf('--agent');
    expect(argv[agentIdx + 1]).toBe('test-reviewer');
  });

  it('threads extraArgs BEFORE the prompt', () => {
    const { argv } = buildCopilotInitialArgv({
      sessionId: 'sid',
      prompt: 'p',
      extraArgs: ['--add-dir', '/tmp/shared'],
    });
    expect(argv).toContain('--add-dir');
    expect(argv[argv.length - 1]).toBe('p');
    expect(argv.indexOf('--add-dir')).toBeLessThan(argv.indexOf('-p'));
  });

  it('keeps the prompt as the LAST argv entry (shell-safe)', () => {
    const { argv } = buildCopilotInitialArgv({
      sessionId: 'sid',
      prompt: 'a multi-word prompt with "quotes" and spaces',
    });
    expect(argv[argv.length - 1]).toBe('a multi-word prompt with "quotes" and spaces');
  });

  it('always allows tools so headless Workers never block on approval', () => {
    const { argv } = buildCopilotInitialArgv({ prompt: 'p' });
    expect(argv).toContain('--allow-all-tools');
  });
});

describe('buildCopilotResumeArgv', () => {
  it('uses --resume <sessionId> + -p <feedback>', () => {
    const argv = buildCopilotResumeArgv({
      sessionId: 'abc-123-uuid',
      feedback: 'reviewer wants edge-case coverage on path P',
    });
    expect(argv).toEqual([
      '--allow-all-tools',
      '--no-color',
      '--log-level',
      'error',
      '--resume',
      'abc-123-uuid',
      '-p',
      'reviewer wants edge-case coverage on path P',
    ]);
  });

  it('does NOT pass --agent on resume (the prior session pinned it)', () => {
    const argv = buildCopilotResumeArgv({
      sessionId: 'sid',
      feedback: 'fb',
    });
    expect(argv).not.toContain('--agent');
  });

  it('threads extraArgs BEFORE the feedback prompt', () => {
    const argv = buildCopilotResumeArgv({
      sessionId: 'sid',
      feedback: 'fb',
      extraArgs: ['--model', 'gpt-5'],
    });
    expect(argv).toContain('--model');
    expect(argv[argv.length - 1]).toBe('fb');
  });

  it('keeps feedback as the LAST argv entry (shell-safe)', () => {
    const argv = buildCopilotResumeArgv({
      sessionId: 'sid',
      feedback: 'a multi-word feedback string',
    });
    expect(argv[argv.length - 1]).toBe('a multi-word feedback string');
  });
});

describe('extractSessionIdFromCopilotOutput', () => {
  it('returns session_id from snake_case envelope', () => {
    const parsed = { type: 'result', session_id: 'sid-snake', result: '{}' };
    expect(extractSessionIdFromCopilotOutput(parsed)).toBe('sid-snake');
  });

  it('returns sessionId from camelCase envelope (defensive fallback)', () => {
    const parsed = { type: 'result', sessionId: 'sid-camel', result: '{}' };
    expect(extractSessionIdFromCopilotOutput(parsed)).toBe('sid-camel');
  });

  it('prefers session_id over sessionId when both present', () => {
    const parsed = {
      type: 'result',
      session_id: 'sid-snake',
      sessionId: 'sid-camel',
      result: '{}',
    };
    expect(extractSessionIdFromCopilotOutput(parsed)).toBe('sid-snake');
  });

  it('returns undefined when neither field is present', () => {
    expect(extractSessionIdFromCopilotOutput({ type: 'result', result: '{}' })).toBeUndefined();
  });

  it('returns undefined on non-object input (null, string, number, undefined)', () => {
    expect(extractSessionIdFromCopilotOutput(null)).toBeUndefined();
    expect(extractSessionIdFromCopilotOutput('string')).toBeUndefined();
    expect(extractSessionIdFromCopilotOutput(42)).toBeUndefined();
    expect(extractSessionIdFromCopilotOutput(undefined)).toBeUndefined();
  });

  it('returns undefined when the session_id field is an empty string', () => {
    expect(extractSessionIdFromCopilotOutput({ session_id: '' })).toBeUndefined();
  });

  it('returns undefined when the session_id field is non-string', () => {
    expect(extractSessionIdFromCopilotOutput({ session_id: 42 })).toBeUndefined();
    expect(extractSessionIdFromCopilotOutput({ session_id: null })).toBeUndefined();
  });
});
