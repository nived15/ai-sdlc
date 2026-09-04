# `--spawner copilot` — GitHub Copilot CLI Operator Runbook

**Status:** Operational and the default. AISDLC-429.1 (design map), AISDLC-429.2
(`CopilotHarnessAdapter` + `--spawner copilot` resolver), and AISDLC-429.3
(orchestrator wiring + operator docs) have shipped. The GitHub Copilot CLI is
the framework's only `SubagentSpawner` for `cli-execute` and the
`cli-orchestrator tick` umbrella dispatcher.

**Applies to:** RFC-0012 Step 0-13 execution backed by the **standalone
`copilot` CLI** (GitHub Copilot CLI, GA 2025). It does NOT cover the
`gh copilot suggest` / `gh copilot explain` autocomplete subcommands of
`gh`, which are not coding-agent dispatchers.

**Companion docs:**

- [`docs/operations/copilot-execution-path.md`](./copilot-execution-path.md) — the per-step design map. Read this first if you want the architectural context that motivated the adapter.
- [`docs/operations/reviewer-dispatch-defaults.md`](./reviewer-dispatch-defaults.md) — reviewer routing + model tiers.
- [`docs/operations/operator-runbook.md`](./operator-runbook.md) — top-level operator runbook; cross-links here from the Execution Path References table.
- [`pipeline-cli/README.md`](../../pipeline-cli/README.md) `#--spawner-options` — the canonical `SpawnerKind` table.

---

## Install path

1. **Install the standalone `copilot` CLI** (NOT `gh copilot`): `npm install -g @github/copilot`. Authenticate (`copilot`, then `/login`) with the GitHub account whose Copilot subscription you want billed for dispatch.
2. **Use the bundled bridge script** — `scripts/copilot-spawn-agent-bridge.mjs` ships in this repo. It reads the adapter's JSON-line request from STDIN, invokes the `copilot` CLI with role-appropriate tool permissions, and writes the response envelope to STDOUT. The protocol is intentionally minimal so any host can implement its own. See the wire format below.
3. **Set `COPILOT_SPAWN_AGENT_BIN`** to the absolute path of the bridge script. The CLI resolver reads this env var when `--spawner copilot` is selected and throws a configuration error before any pipeline mutation if the var is unset.

Programmatic callers can skip the env var entirely and construct
`CopilotHarnessAdapter` directly with their own `CopilotSpawnAgentFn`
injection (e.g. an in-process bridge to Copilot's host tools).

## Wire protocol

The default subprocess bridge (`subprocessCopilotSpawnAgent()` in
`pipeline-cli/src/runtime/spawners/copilot-harness.ts`) speaks a tiny
JSON-line protocol:

| Direction | Stream | Shape |
|---|---|---|
| Adapter → bridge | `stdin` (single JSON line) | `{ "agentType", "systemPrompt", "userPrompt", "cwd", "timeoutMs" }` |
| Bridge → adapter | `stdout` (single JSON envelope) | `{ "output": string, "parsed"?: unknown }` |
| Bridge → adapter | exit code | `0` for success; non-zero surfaces `stderr` as the error |

The adapter spawns the bridge with `cwd` set to the request's `cwd`
(the worktree). Reviewers are dispatched read-only; the developer agent
needs write access to the worktree.

## Env var override

| Env var | Required | Purpose |
|---|---|---|
| `COPILOT_SPAWN_AGENT_BIN` | **Yes** for `--spawner copilot` (CLI form) | Absolute path to the bridge script. Unset → resolver throws `COPILOT_BRIDGE_MISSING_MESSAGE` before any pipeline mutation. Programmatic constructors can skip this. |
| `AI_SDLC_ORCHESTRATOR_SPAWNER=copilot` | No | Default umbrella spawner kind for `cli-orchestrator tick`. Equivalent to passing `--spawner copilot` on every tick. AISDLC-429.3. |

## Quickstart

### `cli-execute` (one-shot)

```bash
export COPILOT_SPAWN_AGENT_BIN="$(pwd)/scripts/copilot-spawn-agent-bridge.mjs"
node ./pipeline-cli/bin/ai-sdlc-pipeline.mjs execute AISDLC-NNN --run --spawner copilot
```

### `cli-orchestrator tick` (autonomous umbrella)

```bash
export COPILOT_SPAWN_AGENT_BIN="$(pwd)/scripts/copilot-spawn-agent-bridge.mjs"
node ./pipeline-cli/bin/cli-orchestrator.mjs tick --spawner copilot
```

Or rely on the default — `copilot` is the effective default spawner kind, so a
bare tick uses it once the bridge env var is set:

```bash
export COPILOT_SPAWN_AGENT_BIN="$(pwd)/scripts/copilot-spawn-agent-bridge.mjs"
node ./pipeline-cli/bin/cli-orchestrator.mjs tick
```

### Programmatic injection (no bridge, no env var)

```typescript
import { CopilotHarnessAdapter } from '@ai-sdlc/pipeline-cli';

const adapter = new CopilotHarnessAdapter({
  spawnAgent: async ({ agentType, systemPrompt, userPrompt, cwd, timeoutMs }) => {
    // Wrap Copilot's host tool / in-process call here.
    return { output: '<agent JSON return>', parsed: { /* optional pre-parse */ } };
  },
});
```

## Billing safety

The CLI resolver **refuses to dispatch at all** when
`COPILOT_SPAWN_AGENT_BIN` is unset and `--spawner copilot` was requested. It
never falls back to another inference provider. This is a deliberate
guardrail: the operator selected the GitHub Copilot subscription billing
model, and a silent fallback to a metered third-party API would violate that
intent.

`cli-orchestrator tick` additionally warns at start-up when a third-party
inference API key (`GITHUB_MODELS_TOKEN`, `GITHUB_MODELS_TOKEN`, `CURSOR_API_KEY`,
`CODEX_API_KEY`, `LLM_API_KEY`) is exported. AI-SDLC never reads those keys,
but leaving one in the environment risks an agent's own tooling billing
outside the Copilot plan.

A stale `AI_SDLC_ORCHESTRATOR_SPAWNER_FALLBACK` export is also surfaced as a
warning. Cross-spawner fallback does not exist in a Copilot-only pipeline;
the variable has no effect and should be unset.

## Reviewer permissions

The bundled bridge grants role-specific tool permissions:

| Role | Copilot flags | Rationale |
|---|---|---|
| `developer` | `--allow-all-tools` | Edits the worktree, runs verification, commits, pushes |
| reviewers | `--allow-tool read --allow-tool search --deny-tool write --deny-tool edit --deny-tool shell` | Read the diff, return a verdict, never mutate the repo |

Caller-supplied `extraArgs` are filtered down to model selection only
(`--model` / `-m`), so a prompt-injected reviewer cannot escalate itself to
write access. See `scripts/copilot-spawn-agent-bridge.test.mjs`.

## Known limitations

| Concern | Status |
|---|---|
| Bridge required | Yes — `COPILOT_SPAWN_AGENT_BIN` must point at a bridge script |
| Canonical bridge shipped in repo | Yes — `scripts/copilot-spawn-agent-bridge.mjs` |
| PATH-based auto-fallback | No — env var only, to keep the billing-safety guarantee simple |
| Reviewer independence | Enforced by construction: each reviewer runs in its own fresh session with a read-only tool grant, and `verify-attestation` rejects envelopes missing any of the three reviewer roles |

## Error messages

When the resolver fails it surfaces one of two messages:

1. **Bridge env var unset** (`COPILOT_BRIDGE_MISSING_MESSAGE` in
   `pipeline-cli/src/runtime/spawners/copilot-harness.ts`):

   > `--spawner copilot` requires COPILOT_SPAWN_AGENT_BIN in the
   > environment (path to a script wrapping Copilot's spawn_agent host
   > tool). Install GitHub Copilot CLI and set COPILOT_SPAWN_AGENT_BIN to
   > the path of your bridge script. For programmatic use, construct
   > CopilotHarnessAdapter directly with a custom CopilotSpawnAgentFn
   > injected.

2. **Bridge exited zero with empty stdout** — the adapter treats this as
   a bridge bug (not as an empty developer JSON envelope) and surfaces
   the failure as a `SubagentResult` error so Step 6's
   `parseDeveloperReturnWithRetry` can retry or escalate cleanly.

In both cases the orchestrator umbrella records the failure as a
`spawner-unavailable` outcome and the AISDLC-177 rollback set fires
before any task mutation lands.

## See also

- [Design map](./copilot-execution-path.md) — the per-step execution path.
- [`CopilotHarnessAdapter` source](../../pipeline-cli/src/runtime/spawners/copilot-harness.ts).
- [Canonical bridge](../../scripts/copilot-spawn-agent-bridge.mjs) — `COPILOT_SPAWN_AGENT_BIN` reference implementation.
- [`cli/execute.ts` resolver](../../pipeline-cli/src/cli/execute.ts) — the `case 'copilot':` branch.
- [`orchestrator/loop.ts`](../../pipeline-cli/src/orchestrator/loop.ts) `resolveUmbrellaSpawnerKind()` — the AISDLC-429.3 wiring that routes `--spawner copilot` through the umbrella dispatcher.
- [`pipeline-cli/README.md` spawner-options table](../../pipeline-cli/README.md#--spawner-options) — the canonical `SpawnerKind` reference.
