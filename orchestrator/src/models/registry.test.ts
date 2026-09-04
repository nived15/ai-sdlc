import { describe, it, expect } from 'vitest';
import {
  ModelRegistry,
  ModelRemovedError,
  UnknownAliasError,
  DEFAULT_REGISTRY,
  type ModelEntry,
} from './registry.js';

describe('ModelRegistry', () => {
  const fixedClock = (iso: string) => () => new Date(iso);

  it('default registry exposes the four canonical aliases', () => {
    const reg = new ModelRegistry();
    expect(
      reg
        .list()
        .map((e) => e.alias)
        .sort(),
    ).toEqual(['fast', 'reasoning', 'reasoning[1m]', 'balanced'].sort());
  });

  describe('resolve', () => {
    it('returns modelId and an ok event for an active alias', () => {
      const reg = new ModelRegistry();
      const r = reg.resolve('balanced');
      expect(r.modelId).toBe('gpt-5');
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toEqual({ type: 'ok', alias: 'balanced', modelId: 'gpt-5' });
    });

    it('throws UnknownAliasError on unrecognized alias', () => {
      const reg = new ModelRegistry();
      expect(() => reg.resolve('mystery-model')).toThrow(UnknownAliasError);
    });

    it('throws ModelRemovedError when removedAt has passed', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'old',
          modelId: 'legacy-model',
          deprecatedAt: '2026-01-01',
          removedAt: '2026-04-01',
          replacementAlias: 'balanced',
        },
      ];
      const reg = new ModelRegistry(entries);
      expect(() => reg.resolve('old', { now: fixedClock('2026-04-15') })).toThrow(
        ModelRemovedError,
      );
    });

    it('emits ModelDeprecated for an alias past deprecatedAt but before removedAt', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'old',
          modelId: 'legacy-model',
          deprecatedAt: '2026-01-01',
          removedAt: '2026-12-01',
          replacementAlias: 'balanced',
        },
      ];
      const reg = new ModelRegistry(entries);
      const r = reg.resolve('old', { now: fixedClock('2026-06-15') });
      expect(r.modelId).toBe('legacy-model');
      const deprecated = r.events.find((e) => e.type === 'ModelDeprecated');
      expect(deprecated).toBeDefined();
      // Not yet in grace period (more than 30 days from removal).
      expect(r.events.some((e) => e.type === 'ModelDeprecationGracePeriod')).toBe(false);
    });

    it('emits ModelDeprecationGracePeriod when within 30 days of removal', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'soon-removed',
          modelId: 'sunsetting-model',
          deprecatedAt: '2026-01-01',
          removedAt: '2026-05-01',
          replacementAlias: 'balanced',
        },
      ];
      const reg = new ModelRegistry(entries);
      // 15 days before removedAt → within grace period
      const r = reg.resolve('soon-removed', { now: fixedClock('2026-04-16') });
      expect(r.events.some((e) => e.type === 'ModelDeprecated')).toBe(true);
      expect(r.events.some((e) => e.type === 'ModelDeprecationGracePeriod')).toBe(true);
    });

    it('does not emit deprecation events when deprecatedAt is in the future', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'future-deprecated',
          modelId: 'future-model',
          deprecatedAt: '2027-01-01',
          removedAt: null,
          replacementAlias: null,
        },
      ];
      const reg = new ModelRegistry(entries);
      const r = reg.resolve('future-deprecated', { now: fixedClock('2026-04-15') });
      expect(r.events).toEqual([
        { type: 'ok', alias: 'future-deprecated', modelId: 'future-model' },
      ]);
    });
  });

  describe('resolveAll', () => {
    it('pins resolution for multiple stages at once', () => {
      const reg = new ModelRegistry();
      const result = reg.resolveAll([
        { stage: 'triage', alias: 'fast' },
        { stage: 'plan', alias: 'balanced' },
        { stage: 'implement', alias: 'reasoning[1m]' },
      ]);
      expect(result.get('triage')?.modelId).toBe('gpt-5-mini');
      expect(result.get('plan')?.modelId).toBe('gpt-5');
      expect(result.get('implement')?.modelId).toBe('gpt-5[reasoning=high,context=1m]');
    });

    it('throws on first unknown alias', () => {
      const reg = new ModelRegistry();
      expect(() =>
        reg.resolveAll([
          { stage: 'triage', alias: 'fast' },
          { stage: 'plan', alias: 'mystery' },
        ]),
      ).toThrow(UnknownAliasError);
    });
  });

  describe('bumpPlan', () => {
    it('returns no entries when nothing is deprecated', () => {
      const reg = new ModelRegistry();
      const plan = reg.bumpPlan([{ stage: 'triage', alias: 'fast' }]);
      expect(plan).toEqual([]);
    });

    it('reports stages whose alias resolves to a deprecated model with replacement details', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'fast',
          modelId: 'gpt-5-mini',
          deprecatedAt: '2026-03-01',
          removedAt: '2026-09-01',
          replacementAlias: 'fast-next',
        },
        {
          alias: 'fast-next',
          modelId: 'gpt-5-mini-next',
          deprecatedAt: null,
          removedAt: null,
          replacementAlias: null,
        },
      ];
      const reg = new ModelRegistry(entries);
      const plan = reg.bumpPlan([{ stage: 'triage', alias: 'fast' }], {
        now: fixedClock('2026-06-15'),
      });
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        stage: 'triage',
        alias: 'fast',
        currentModelId: 'gpt-5-mini',
        replacementAlias: 'fast-next',
        replacementModelId: 'gpt-5-mini-next',
        inGracePeriod: false,
      });
    });

    it('flags inGracePeriod when within 30 days of removal', () => {
      const entries: ModelEntry[] = [
        {
          alias: 'old',
          modelId: 'legacy-model',
          deprecatedAt: '2026-01-01',
          removedAt: '2026-05-01',
          replacementAlias: 'balanced',
        },
      ];
      const reg = new ModelRegistry(entries);
      const plan = reg.bumpPlan([{ stage: 's1', alias: 'old' }], {
        now: fixedClock('2026-04-20'),
      });
      expect(plan[0].inGracePeriod).toBe(true);
    });
  });

  it('the shipped DEFAULT_REGISTRY entries are all active (no deprecation)', () => {
    for (const e of DEFAULT_REGISTRY) {
      expect(e.deprecatedAt).toBeNull();
      expect(e.removedAt).toBeNull();
    }
  });
});
