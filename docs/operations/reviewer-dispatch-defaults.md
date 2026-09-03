# Reviewer dispatch defaults (AISDLC-483)

> **TL;DR:** Every role dispatches through the GitHub Copilot CLI. Code, test,
> and developer roles run on the **balanced** model tier; security review runs
> on the **reasoning** tier. Override the reviewer tier with
> `AI_SDLC_REVIEWER_MODEL_TIER`.

## Default routing by role

| Role | Agent | Harness | Model tier | Rationale |
|---|---|---|---|---|
| code-review | `code-reviewer` | `copilot` | balanced | Mechanical correctness + conventions |
| test-review | `test-reviewer` | `copilot` | balanced | Coverage, regression guards, assertions |
| security | `security-reviewer` | `copilot` | reasoning | Adversarial OWASP-class analysis |
| developer | `developer` | `copilot` | balanced | Highest-volume role (one per task) |

## Rationale

A cost incident traced 26% of a week's usage to a single session where every
subagent inherited the operator's top-tier model. AISDLC-482 pinned agent
frontmatter defaults; AISDLC-483 hardens the dispatch paths so even ad-hoc
agent calls or manual `/ai-sdlc execute` invocations route to the intended
tier by default.

**Why the reasoning tier for security only?** Security review is
reasoning-heavy, adversarial-pattern recognition work where model quality
directly affects a trust decision. Every other role is mechanical enough that
the balanced tier matches quality at materially lower cost.

**Why the balanced tier for the developer?** Developer dispatch is the
highest-volume role (one per task). The `developer` agent frontmatter pins
`model: balanced`; the dispatch path does not override it.

**Why is reviewer independence still guaranteed?** Each reviewer is dispatched
into its own fresh Copilot CLI session with a read-only tool grant (see
`scripts/copilot-spawn-agent-bridge.mjs`). A reviewer cannot see the
implementer's conversation, and cannot write to the worktree. Completeness is
enforced at verification time: `verify-attestation` rejects any envelope that
is missing one of the three reviewer roles.

## How to override

### Pin every reviewer to one tier

Set the env var before invoking `/ai-sdlc execute` or `/ai-sdlc orchestrator-tick`:

```bash
export AI_SDLC_REVIEWER_MODEL_TIER=reasoning
/ai-sdlc execute AISDLC-NNN
```

Accepted values: `balanced`, `reasoning`, `inherit` (let each agent's own
frontmatter govern). Invalid values are ignored so a typo can never silently
downgrade a security review.

Developer dispatch is never affected by this override.

### Override per invocation (shell one-liner)

```bash
AI_SDLC_REVIEWER_MODEL_TIER=reasoning /ai-sdlc execute AISDLC-NNN
```

### Override developer model per invocation

The developer agent frontmatter pins `model: balanced`. To use a different tier
for a single dispatch (e.g. `reasoning` for a particularly complex task), set
`AI_SDLC_DEV_MODEL=reasoning` — the `orchestrator-tick` command body forwards
this as a per-invocation hint in the developer prompt. (Not enforced by the
dispatch layer; the agent honors it if present.)

## Programmatic access

The selection logic lives in `pipeline-cli/src/dispatch/reviewer-harness.ts` and
is exported from `@ai-sdlc/pipeline-cli`:

```typescript
import { resolveReviewer, resolveReviewerByClassifierName } from '@ai-sdlc/pipeline-cli';

// By role:
const { agentName, harness, model } = resolveReviewer('code');
// → { agentName: 'code-reviewer', harness: 'copilot', model: 'balanced' }

// By classifier name (used in /ai-sdlc execute Step 7):
const result = resolveReviewerByClassifierName('security');
// → { agentName: 'security-reviewer', harness: 'copilot', model: 'reasoning' }

// With an explicit tier override:
const pinned = resolveReviewer('code', 'reasoning');
// → { agentName: 'code-reviewer', harness: 'copilot', model: 'reasoning' }
```

## GitHub Copilot CLI requirement

All roles require `copilot` on PATH. Confirm with:

```bash
which copilot       # should print the path to the GitHub Copilot CLI
copilot --version
```

If `copilot` is absent, `buildReviewPrompts` stamps a
`⚠ REVIEW HARNESS UNAVAILABLE` note into every reviewer prompt and the
`--spawner copilot` resolver refuses to dispatch rather than silently falling
back to another provider.

See also: [`docs/operations/copilot-spawner.md`](./copilot-spawner.md) for
bridge configuration and [`docs/operations/copilot-execution-path.md`](./copilot-execution-path.md)
for the per-step design map.
