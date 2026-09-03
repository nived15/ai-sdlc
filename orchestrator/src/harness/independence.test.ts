import { describe, it, expect } from 'vitest';
import {
  enforceIndependence,
  validateIndependenceGraph,
  CyclicIndependenceConstraintError,
} from './independence.js';
import type { HarnessName } from './types.js';

/**
 * `enforceIndependence` is a pure set-filter over harness names. The framework
 * ships a single harness (`copilot`), so these tests drive the filter with
 * synthetic names to keep the algorithm covered independently of the shipped
 * registry. The cast is deliberate — it exercises the generic contract, not the
 * production enum.
 */
const asHarnesses = (names: string[]): HarnessName[] => names as unknown as HarnessName[];

describe('enforceIndependence', () => {
  it('removes harnesses that ran upstream stages named in requiresIndependentHarnessFrom', () => {
    const result = enforceIndependence(
      asHarnesses(['alpha', 'beta']),
      ['implement'],
      [{ stage: 'implement', resolvedHarness: 'alpha' as HarnessName }],
    );
    expect(result.effectiveChain).toEqual(['beta']);
    expect(result.removed).toEqual(['alpha']);
    expect(result.forbidden).toEqual(['alpha']);
    expect(result.violated).toBe(false);
  });

  it('preserves the chain when no upstream stage is named', () => {
    const result = enforceIndependence(
      asHarnesses(['alpha', 'beta']),
      [],
      [{ stage: 'implement', resolvedHarness: 'alpha' as HarnessName }],
    );
    expect(result.effectiveChain).toEqual(['alpha', 'beta']);
    expect(result.violated).toBe(false);
  });

  it('reports violated when the filter empties the chain', () => {
    const result = enforceIndependence(
      asHarnesses(['alpha']),
      ['implement'],
      [{ stage: 'implement', resolvedHarness: 'alpha' as HarnessName }],
    );
    expect(result.effectiveChain).toEqual([]);
    expect(result.violated).toBe(true);
  });

  it('multiple upstream stages contribute to forbidden set', () => {
    const result = enforceIndependence(
      asHarnesses(['alpha', 'beta', 'gamma']),
      ['implement', 'plan'],
      [
        { stage: 'implement', resolvedHarness: 'alpha' as HarnessName },
        { stage: 'plan', resolvedHarness: 'beta' as HarnessName },
      ],
    );
    expect(result.effectiveChain).toEqual(['gamma']);
    expect(result.forbidden.sort()).toEqual(['alpha', 'beta'].sort());
  });

  it('ignores upstream names that are not in the upstreamRuns map', () => {
    const result = enforceIndependence(
      asHarnesses(['alpha', 'beta']),
      ['implement', 'phantom'],
      [{ stage: 'implement', resolvedHarness: 'alpha' as HarnessName }],
    );
    expect(result.effectiveChain).toEqual(['beta']);
    expect(result.forbidden).toEqual(['alpha']);
  });

  it('empties the chain when the only shipped harness ran upstream', () => {
    // The realistic single-harness case: `copilot` implemented, so a stage that
    // demands an independent harness has nothing left to fall back to. The
    // orchestrator surfaces this as `violated` rather than silently reusing it.
    const result = enforceIndependence(
      ['copilot'],
      ['implement'],
      [{ stage: 'implement', resolvedHarness: 'copilot' }],
    );
    expect(result.effectiveChain).toEqual([]);
    expect(result.violated).toBe(true);
  });
});

describe('validateIndependenceGraph', () => {
  it('returns [] for a valid graph (review-security depends on implement)', () => {
    const cycles = validateIndependenceGraph([
      { name: 'implement' },
      { name: 'review-security', requiresIndependentHarnessFrom: ['implement'] },
    ]);
    expect(cycles).toEqual([]);
  });

  it('flags self-references as cycles', () => {
    const cycles = validateIndependenceGraph([
      { name: 'implement', requiresIndependentHarnessFrom: ['implement'] },
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].stage).toBe('implement');
  });

  it('flags references to downstream stages as cycles', () => {
    const cycles = validateIndependenceGraph([
      { name: 'plan', requiresIndependentHarnessFrom: ['implement'] },
      { name: 'implement' },
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].stage).toBe('plan');
  });

  it('flags references to unknown stages', () => {
    const cycles = validateIndependenceGraph([
      { name: 'review-security', requiresIndependentHarnessFrom: ['nonexistent'] },
    ]);
    expect(cycles[0].references).toMatch(/unknown stage/);
  });

  it('CyclicIndependenceConstraintError captures all cycles', () => {
    const cycles = [
      { stage: 's1', references: 'self' },
      { stage: 's2', references: "'s3' is downstream" },
    ];
    const err = new CyclicIndependenceConstraintError(cycles);
    expect(err.message).toMatch(/s1/);
    expect(err.message).toMatch(/s2/);
    expect(err.cycles).toEqual(cycles);
  });
});
