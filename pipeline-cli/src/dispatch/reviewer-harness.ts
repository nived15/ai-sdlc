/**
 * Reviewer-harness selection logic (AISDLC-483).
 *
 * Maps a reviewer role to the canonical agent name and model. AI-SDLC
 * dispatches every role through the GitHub Copilot CLI, so the harness is
 * always `copilot`; what varies per role is the agent definition and the
 * reasoning tier the role needs.
 *
 * Routing:
 *   - code-review   → code-reviewer      (Copilot, balanced tier)
 *   - test-review   → test-reviewer      (Copilot, balanced tier)
 *   - security      → security-reviewer  (Copilot, reasoning tier)
 *   - developer     → developer          (Copilot, balanced tier)
 *
 * `AI_SDLC_REVIEWER_MODEL_TIER` lets an operator pin every reviewer to a
 * single tier (e.g. `reasoning` for a high-stakes release branch, or
 * `inherit` to let each agent's own frontmatter govern). Developer dispatch
 * is never affected by that override.
 */

/** The four dispatchable roles. */
export type ReviewerRole = 'code' | 'test' | 'security' | 'developer';

/** The only dispatch harness AI-SDLC supports. */
export const COPILOT_HARNESS = 'copilot' as const;

/** Env-var name that overrides the per-role model tier. */
export const REVIEWER_MODEL_TIER_ENV = 'AI_SDLC_REVIEWER_MODEL_TIER' as const;

/**
 * Reasoning tiers a reviewer can be dispatched at.
 *
 * `inherit` means the agent frontmatter governs (used when the agent already
 * pins its own tier).
 */
export type ReviewerModelTier = 'inherit' | 'balanced' | 'reasoning';

const VALID_TIERS: readonly ReviewerModelTier[] = ['inherit', 'balanced', 'reasoning'] as const;

/**
 * The resolved agent name + model tier for a given role.
 */
export interface ResolvedReviewer {
  /** The agent name as it appears in ai-sdlc-plugin/agents/<name>.md */
  agentName: string;
  /** The billing harness — always the operator's GitHub Copilot subscription. */
  harness: typeof COPILOT_HARNESS;
  /** The reasoning tier the agent should be dispatched at. */
  model: ReviewerModelTier;
}

function parseTierOverride(raw: string | undefined): ReviewerModelTier | undefined {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return undefined;
  return VALID_TIERS.includes(value as ReviewerModelTier)
    ? (value as ReviewerModelTier)
    : undefined;
}

/**
 * Resolve the agent name + model tier for a reviewer role.
 *
 * @param role          - The role to resolve.
 * @param overrideTier  - Explicit tier override (defaults to
 *                        `process.env.AI_SDLC_REVIEWER_MODEL_TIER`).
 *                        Invalid values are ignored so a typo can never
 *                        silently downgrade a security review.
 */
export function resolveReviewer(role: ReviewerRole, overrideTier?: string): ResolvedReviewer {
  // Developer dispatch is never affected by the reviewer-tier override.
  if (role === 'developer') {
    return { agentName: 'developer', harness: COPILOT_HARNESS, model: 'balanced' };
  }

  const tier = parseTierOverride(overrideTier ?? process.env[REVIEWER_MODEL_TIER_ENV]);

  // Security review defaults to the reasoning tier — it is the one role where
  // the extra reasoning budget consistently pays for itself.
  if (role === 'security') {
    return {
      agentName: 'security-reviewer',
      harness: COPILOT_HARNESS,
      model: tier ?? 'reasoning',
    };
  }

  return {
    agentName: role === 'code' ? 'code-reviewer' : 'test-reviewer',
    harness: COPILOT_HARNESS,
    model: tier ?? 'balanced',
  };
}

/**
 * Map the classifier output name (`testing`, `critic`, `security`) to a
 * `ReviewerRole`, then call `resolveReviewer`.
 *
 * This is the entry point used by the `/ai-sdlc execute` and
 * `/ai-sdlc orchestrator-tick` command bodies where classifier names are used.
 *
 * @param classifierName - One of 'testing' | 'critic' | 'security'
 * @param overrideTier   - Explicit tier override (defaults to env var).
 */
export function resolveReviewerByClassifierName(
  classifierName: string,
  overrideTier?: string,
): ResolvedReviewer {
  switch (classifierName) {
    case 'testing':
      return resolveReviewer('test', overrideTier);
    case 'critic':
      return resolveReviewer('code', overrideTier);
    case 'security':
      return resolveReviewer('security', overrideTier);
    default:
      // Unknown classifier name — dispatch it anyway at the balanced tier so
      // the pipeline doesn't silently drop an unknown reviewer.
      return {
        agentName: classifierName,
        harness: COPILOT_HARNESS,
        model:
          parseTierOverride(overrideTier ?? process.env[REVIEWER_MODEL_TIER_ENV]) ?? 'balanced',
      };
  }
}
