---
id: AISDLC-429
title: 'feat(pipeline-cli): GitHub Copilot CLI as the coding harness for `--spawner copilot`'
status: To Do
labels:
  - enhancement
  - pipeline-cli
  - rfc-0012
  - copilot
  - spawner
  - parent
  - developer-experience
dependencies: []
assumes:
  - RFC-0012
references:
  - pipeline-cli/src/cli/execute.ts
  - pipeline-cli/src/runtime/spawners/copilot-harness.ts
  - pipeline-cli/src/runtime/default-spawner.ts
  - pipeline-cli/src/runtime/subagent-spawner.ts
  - pipeline-cli/src/orchestrator/loop.ts
  - pipeline-cli/README.md
priority: medium
permittedExternalPaths: []
blocked:
  reason: 'Umbrella parent task — dispatch sub-phases AISDLC-429.1, AISDLC-429.2, AISDLC-429.3 directly. 429.1 (design map, paper-only) unblocks 429.2 (adapter + resolver); 429.2 unblocks 429.3 (orchestrator wiring + docs). Parent unblocks when all three sub-tasks reach Done.'
  unblockedBy:
    - AISDLC-429.1
    - AISDLC-429.2
    - AISDLC-429.3
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Operators who pay for **GitHub Copilot** (Business / Enterprise / Pro+) have a coding-grade CLI (`copilot` — the standalone GitHub Copilot CLI, distinct from `gh copilot`) that can drive a multi-step developer + reviewer loop. The pipeline needs a first-class way to dispatch through that harness so `/ai-sdlc execute` runs on the operator's Copilot subscription.

## Goal

Ship a `CopilotHarnessAdapter` that implements `SubagentSpawner` by bridging to GitHub Copilot CLI's coding-agent invocation, and make `--spawner copilot` selectable from both `cli-execute` and `cli-orchestrator tick`. The adapter is callback-driven and host-agnostic, plus a default subprocess bridge that shells out to `$COPILOT_SPAWN_AGENT_BIN`.

## Non-goals

- Building Copilot-specific RFC tooling, billing telemetry, or Copilot-side MCP servers. Treat Copilot CLI as a generic agent dispatcher: the adapter sends a system prompt + user prompt, gets back text + optional pre-parsed JSON, normalises to `SubagentResult`.
- Conductor/Worker (RFC-0041) Worker support. The initial cut only wires the `executePipeline()` path.

## Composes with

- **RFC-0012 §8 (SubagentSpawner)** — the spawner contract this implements.
- **`cli-orchestrator tick --spawner` plumbing** — `SpawnerKind` is referenced in `pipeline-cli/src/orchestrator/loop.ts` (`umbrellaSpawnerKind`, `resolveUmbrellaSpawnerKind`).
- **`pipeline-cli/README.md`** — the "Spawner kinds" table needs a `copilot` row, as does the spawner-kinds list in `.github/copilot-instructions.md`.

## Risk

- **Copilot CLI surface stability**: the standalone `copilot` CLI is comparatively new (GA 2025). The adapter must isolate the wire format behind `CopilotSpawnAgentFn` (callback boundary). If the CLI's invocation grammar changes, only the subprocess bridge changes — the adapter contract is stable.
- **Hermetic tests**: tests MUST mock `CopilotSpawnAgentFn` and never touch a real `copilot` binary, so `pnpm test` runs everywhere.
- **Billing safety**: Copilot CLI bills against the operator's GitHub Copilot subscription. The CLI parse path MUST fail clearly when `$COPILOT_SPAWN_AGENT_BIN` is unset, rather than silently falling back to any third-party inference key.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 All three sub-tasks (AISDLC-429.1, AISDLC-429.2, AISDLC-429.3) reach Done status.
- [ ] #2 `pnpm --filter @ai-sdlc/pipeline-cli exec` exposes `--spawner copilot` end-to-end through `cli-execute` and `cli-orchestrator tick`, with full operator-facing wiring.
- [ ] #3 Operator-facing documentation (`pipeline-cli/README.md` spawner-kinds table + `.github/copilot-instructions.md` "Spawner kinds" list + `docs/operations/copilot-spawner.md` runbook + cross-link from the operator runbook) is up to date and reviewable as the canonical source for picking the `copilot` kind.

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Adapter layout.**

- `CopilotSpawnAgentRequest` / `CopilotSpawnAgentResponse` / `CopilotSpawnAgentFn` — the narrow boundary the host bridge implements.
- `CopilotHarnessAdapter implements SubagentSpawner` with `spawn()` and `spawnParallel()`.
- Per-`SubagentType` default system prompts (minimal "behave like the ai-sdlc <type>" strings); operators can override via `systemPrompts` constructor option to inject the full plugin-agent bodies.
- Response normalisation: developer → `DeveloperReturn`, reviewers → `{approved, findings, summary, harness:'copilot'}`.

**Subprocess bridge.** The default `subprocessCopilotSpawnAgent()` should:

1. Read `$COPILOT_SPAWN_AGENT_BIN` — this lets operators wrap the CLI in their own auth/transport — and fail with a clear configuration message when it is unset.
2. Document the chosen invocation grammar in the operator runbook and keep the adapter contract stable across grammar revisions by funnelling all wire-format concerns through the bridge.
3. Use `child_process.spawn` (not `execFile`) so we can stream stdout/stderr without buffering the full transcript in memory.
4. Honour the per-call `timeoutMs` from the request.

**Slug fallback.** Step 2's `computeBranchSlug` (`pipeline-cli/src/steps/02-compute-branch.ts`) already handles the adapter's branch naming — no Copilot-specific change needed.

**Phase suggestion (operator may split).** If the wire-format research for the `copilot` CLI invocation surfaces material gaps, prefer splitting into three sub-tasks created via `task_create` BEFORE dispatching implementation:

- Phase 1 sub-task: Document the Copilot execution path + invocation grammar gaps (no code).
- Phase 2 sub-task: `CopilotHarnessAdapter` + `--spawner copilot` resolver (bulk of the work; covers AC #1 through #4 plus #8 and #9).
- Phase 3 sub-task: Orchestrator wiring + docs + runbook (covers AC #5 through #7).

A single PR is acceptable if the wire format is stable and the diff stays reviewable; otherwise file the phase sub-tasks (per the "Create-before-execution" rule in .github/copilot-instructions.md) before dispatching implementation.

**Out-of-scope reminder.** Do NOT resolve any RFC Open Questions inline. If the implementation surfaces a question that touches RFC-0012's `SubagentSpawner` contract semantics, escalate per .github/copilot-instructions.md "Subagent Governance — OQ-resolution prohibition (AISDLC-298)" — return `prUrl: null` with a notes field and stop.
<!-- SECTION:NOTES:END -->
