/**
 * Hermetic unit tests for the reviewer-harness selector (AISDLC-483).
 *
 * Asserts that with no override env vars set, the selection logic resolves:
 *   - code-reviewer  → code-reviewer      (copilot, balanced)
 *   - test-reviewer  → test-reviewer      (copilot, balanced)
 *   - security       → security-reviewer  (copilot, reasoning)
 *   - developer      → developer          (copilot, balanced)
 *
 * Also covers:
 *   - AI_SDLC_REVIEWER_MODEL_TIER pins the tier for the three review roles
 *     and leaves developer dispatch unchanged.
 *   - An invalid tier value is ignored rather than silently downgrading
 *     the security review.
 *   - resolveReviewerByClassifierName maps 'testing'/'critic'/'security'
 *     correctly.
 *   - Unknown classifier names produce a safe fallback (no panic).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COPILOT_HARNESS,
  resolveReviewer,
  resolveReviewerByClassifierName,
  REVIEWER_MODEL_TIER_ENV,
} from './reviewer-harness.js';

// Capture + restore the env var around each test so tests don't bleed.
const ORIGINAL_ENV = process.env[REVIEWER_MODEL_TIER_ENV];

beforeEach(() => {
  delete process.env[REVIEWER_MODEL_TIER_ENV];
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[REVIEWER_MODEL_TIER_ENV];
  } else {
    process.env[REVIEWER_MODEL_TIER_ENV] = ORIGINAL_ENV;
  }
});

describe('resolveReviewer — default routing', () => {
  it('routes code review to code-reviewer on Copilot at the balanced tier', () => {
    expect(resolveReviewer('code')).toEqual({
      agentName: 'code-reviewer',
      harness: COPILOT_HARNESS,
      model: 'balanced',
    });
  });

  it('routes test review to test-reviewer on Copilot at the balanced tier', () => {
    expect(resolveReviewer('test')).toEqual({
      agentName: 'test-reviewer',
      harness: COPILOT_HARNESS,
      model: 'balanced',
    });
  });

  it('routes security review to the reasoning tier', () => {
    expect(resolveReviewer('security')).toEqual({
      agentName: 'security-reviewer',
      harness: COPILOT_HARNESS,
      model: 'reasoning',
    });
  });

  it('routes the developer role to Copilot at the balanced tier', () => {
    expect(resolveReviewer('developer')).toEqual({
      agentName: 'developer',
      harness: COPILOT_HARNESS,
      model: 'balanced',
    });
  });

  it('never resolves a harness other than copilot', () => {
    for (const role of ['code', 'test', 'security', 'developer'] as const) {
      expect(resolveReviewer(role).harness).toBe('copilot');
    }
  });
});

describe('resolveReviewer — model-tier override', () => {
  it('honours an explicit tier argument for the review roles', () => {
    expect(resolveReviewer('code', 'reasoning').model).toBe('reasoning');
    expect(resolveReviewer('test', 'inherit').model).toBe('inherit');
    expect(resolveReviewer('security', 'balanced').model).toBe('balanced');
  });

  it('honours the env var when no explicit tier is passed', () => {
    process.env[REVIEWER_MODEL_TIER_ENV] = 'inherit';
    expect(resolveReviewer('code').model).toBe('inherit');
    expect(resolveReviewer('security').model).toBe('inherit');
  });

  it('leaves developer dispatch unaffected by the override', () => {
    process.env[REVIEWER_MODEL_TIER_ENV] = 'inherit';
    expect(resolveReviewer('developer').model).toBe('balanced');
  });

  it('ignores an invalid tier rather than downgrading security review', () => {
    expect(resolveReviewer('security', 'not-a-tier').model).toBe('reasoning');
    expect(resolveReviewer('code', 'not-a-tier').model).toBe('balanced');
  });
});

describe('resolveReviewerByClassifierName', () => {
  it('maps testing → test-reviewer', () => {
    expect(resolveReviewerByClassifierName('testing').agentName).toBe('test-reviewer');
  });

  it('maps critic → code-reviewer', () => {
    expect(resolveReviewerByClassifierName('critic').agentName).toBe('code-reviewer');
  });

  it('maps security → security-reviewer at the reasoning tier', () => {
    expect(resolveReviewerByClassifierName('security')).toEqual({
      agentName: 'security-reviewer',
      harness: COPILOT_HARNESS,
      model: 'reasoning',
    });
  });

  it('falls back safely for an unknown classifier name', () => {
    expect(resolveReviewerByClassifierName('mystery-reviewer')).toEqual({
      agentName: 'mystery-reviewer',
      harness: COPILOT_HARNESS,
      model: 'balanced',
    });
  });
});
