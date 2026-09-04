# `@ai-sdlc/dogfood`

The dogfood pipeline runs the AI-SDLC framework against its own repository.
Two CLI surfaces:

| Command | Backing implementation | Billing | When to use |
|---|---|---|---|
| `pnpm --filter @ai-sdlc/dogfood execute --issue <id>` | `@ai-sdlc/orchestrator` `Orchestrator` class (Pipeline-resource driven, plugins + admission + autonomy + provenance + audit log + OTEL) | API key | Full GitHub-issue / unattended / CI workflow with admission scoring, autonomy gating, provenance attestation. |
| `pnpm --filter @ai-sdlc/dogfood watch --issue <id> [...]` | `@ai-sdlc/pipeline-cli` `executePipeline()` Tier 2 composite (Steps 0-13 only) | Subscription (default) or API key | Backlog-task-centric runs that just need the bare Step 0-13 pipeline. Per RFC-0012, future Phase 6 work will restore the higher-level governance primitives on top of this entry point. |

For the canonical day-to-day path (an operator on their own machine driving
backlog tasks under subscription billing), use `/ai-sdlc execute <task-id>`
inside GitHub Copilot CLI — it spawns the developer + 3 reviewer subagents directly
without going through either CLI above.

## `watch` CLI

```sh
pnpm --filter @ai-sdlc/dogfood watch --issue <id> [--issue <id> ...] \
  [--spawner auto|shell|sdk|mock]
```

### Flags

- `--issue <id>` — backlog task ID to dispatch. Repeatable; each issue runs
  the full Step 0-13 pipeline sequentially against the same spawner.
- `--spawner <kind>` (default `auto`) — selects the `SubagentSpawner` per
  RFC-0012 §8.3:
  - `auto` — `defaultSpawner()` resolution: `CopilotHarnessAdapter` when the
    `copilot` CLI is on `PATH`; falls back to `CopilotHarnessAdapter` when
    `GITHUB_MODELS_TOKEN` is set; throws otherwise.
  - `shell` — force `CopilotHarnessAdapter` (subscription billing via
    operator's `copilot` CLI).
  - `sdk` — force `CopilotHarnessAdapter` (API-key billing via the
    `@github/copilot` SDK).
  - `mock` — `MockSpawner` from pipeline-cli with auto-approving fixtures.
    Intended for smoke tests + the watch CLI's own integration tests; does
    NOT produce real code changes.

### History — RFC-0012 Phase 5 migration (AISDLC-100.5)

Pre-AISDLC-100.5, this CLI wrapped `@ai-sdlc/orchestrator`'s
reconciler-driven `startWatch` and dispatched each enqueued issue through
the orchestrator's Pipeline-resource `executePipeline`. Phase 5 migrates the
inner pipeline call to the simpler `@ai-sdlc/pipeline-cli` `executePipeline()`
composite. Behaviors the previous orchestrator-driven path supported that
this CLI no longer wires up:

- Reconciler retry/backoff (`ReconcilerLoop`, `createResourceCache`,
  priority scoring) — each `--issue` runs once and sequentially.
- Pipeline-resource routing (the auto-selection of
  `dogfood-backlog-pipeline` for AISDLC-* IDs) — the orchestrator-driven
  `cli.ts` (`pnpm execute`) remains for that surface.
- Admission gating (RFC-0008), autonomy policy enforcement, audit log
  writes, OTEL instrumentation, structured logger, agent discovery,
  provenance attestation, multi-resource (Gate / AutonomyPolicy) queues.

Restoring those behaviors is tracked as a Phase 6 follow-up: either by
re-introducing a thin reconciler shell around `executePipeline()` or by
surfacing the missing primitives through `@ai-sdlc/pipeline-cli`.
