/**
 * Unit tests for cross-provider compatibility per RFC-0019 §9.3 OQ-3 split.
 *
 * Covers AISDLC-339 AC#6, AC#7:
 *  - Cross-PROVIDER: ALWAYS refuse + emit migration task
 *  - Cross-VERSION-within-provider: returns 'cross-version' (caller delegates)
 *  - Compatible: matching provenance returns 'compatible'
 */

import { describe, it, expect } from 'vitest';
import {
  checkProviderCompatibility,
  CrossProviderComparisonError,
  buildCrossProviderDecisionPayload,
} from './cross-provider.js';

describe('checkProviderCompatibility', () => {
  it('AC#7: same provider + same version → compatible', () => {
    expect(
      checkProviderCompatibility(
        'github-models-embedding-small',
        '2024-01-25',
        'github-models-embedding-small',
        '2024-01-25',
      ),
    ).toBe('compatible');
  });

  it('AC#7: same provider, different version → cross-version (delegates to staleVectorPolicy)', () => {
    expect(
      checkProviderCompatibility(
        'github-models-embedding-small',
        '2024-01-25',
        'github-models-embedding-small',
        '2025-01-25',
      ),
    ).toBe('cross-version');
  });

  it('AC#6: different provider, same version → cross-provider (ALWAYS refuse)', () => {
    expect(
      checkProviderCompatibility(
        'github-models-embedding-small',
        '2024-01-25',
        'self-hosted-embed-v3',
        '2024-01-25',
      ),
    ).toBe('cross-provider');
  });

  it('AC#6: different provider, different version → cross-provider (provider takes precedence)', () => {
    // The split rule says cross-PROVIDER ALWAYS wins; version difference is
    // irrelevant once the provider differs.
    expect(
      checkProviderCompatibility(
        'github-models-embedding-small',
        '2024-01-25',
        'self-hosted-embed-v3',
        '2025-06-01',
      ),
    ).toBe('cross-provider');
  });
});

describe('CrossProviderComparisonError', () => {
  it('AC#6: error message names both providers and the migration command', () => {
    const err = new CrossProviderComparisonError(
      'github-models-embedding-small',
      'self-hosted-embed-v3',
      'hash-789',
    );
    expect(err.name).toBe('CrossProviderComparisonError');
    expect(err.message).toContain('github-models-embedding-small');
    expect(err.message).toContain('self-hosted-embed-v3');
    expect(err.message).toContain('cli-embedding-bump --to self-hosted-embed-v3');
    expect(err.message).toContain('hash-789');
  });

  it('omits the textHash hint when not provided', () => {
    const err = new CrossProviderComparisonError(
      'github-models-embedding-small',
      'self-hosted-embed-v3',
    );
    expect(err.message).not.toContain('offending textHash');
  });
});

describe('buildCrossProviderDecisionPayload', () => {
  it('AC#6: payload carries severity high + auto-action emit-migration-task', () => {
    const payload = buildCrossProviderDecisionPayload(
      'github-models-embedding-small',
      'self-hosted-embed-v3',
    );
    expect(payload.severity).toBe('high');
    expect(payload.autoAction).toBe('emit-migration-task');
    expect(payload.migrationCommand).toBe('cli-embedding-bump --to self-hosted-embed-v3');
    expect(payload.summary).toContain('github-models-embedding-small');
    expect(payload.summary).toContain('self-hosted-embed-v3');
    expect(payload.summary).toContain('Refused');
  });
});
