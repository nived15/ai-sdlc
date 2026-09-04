# Agent Runners

The orchestrator invokes AI coding agents through the `AgentRunner` interface. Runners are auto-discovered from environment variables via the `RunnerRegistry`.

## AgentRunner Interface

Every runner implements:

```typescript
interface AgentRunner {
  run(ctx: AgentContext): Promise<AgentResult>;
}
```

The orchestrator provides context (issue details, codebase profile, constraints) and the runner spawns the agent, collects output, and commits changes.

## Available Runners

### CopilotRunner

Invokes the [GitHub Copilot CLI](https://docs.github.com/en/copilot) in `--yolo`
autonomous mode. This is the framework's only built-in runner.

| Property | Value |
|---|---|
| CLI command | `copilot -p <prompt> --yolo [--model <model>]` |
| stdin | None (prompt is a CLI argument) |
| Auth | `GH_TOKEN` or `GITHUB_TOKEN` (passed through environment) |
| Model override | `AI_SDLC_COPILOT_MODEL` env var |
| Registration | Always available (built-in) |

```typescript
import { CopilotRunner } from '@ai-sdlc/orchestrator';
```

The runner collects changed files via `git diff`, stages them, and commits with
the configured message template and co-author trailer.

## Selecting a Runner

### `--runner <name>` flag

The `ai-sdlc run` command accepts a `--runner <name>` flag to select any registered runner by name:

```bash
ai-sdlc run --issue 42 --runner copilot   # the built-in default
```

If the specified name is not registered, the command fails immediately with an actionable error listing the available runners — **no silent fallback**.

### `AI_SDLC_RUNNER_PLUGIN` environment variable

To plug in a custom runner (e.g. Kiro, a proprietary agent CLI, or a test double) without forking the package, set `AI_SDLC_RUNNER_PLUGIN` to the path of a module that exports an `AgentRunner`:

```bash
export AI_SDLC_RUNNER_PLUGIN=/path/to/my-runner.mjs
ai-sdlc run --issue 42
```

The module must export a default export **or** a named `runner` export satisfying the `AgentRunner` interface:

```typescript
// my-runner.mjs  (ESM)
export default {
  async run(ctx) {
    // Invoke your agent, commit changes, return AgentResult
    return { success: true, filesChanged: ['src/fix.ts'], summary: 'Done.' };
  },
};
```

Or with a named export:

```typescript
// my-runner.mjs
export const runner = {
  async run(ctx) { /* ... */ }
};
```

If the module cannot be imported or does not export a valid `AgentRunner`, the pipeline fails immediately with an actionable error — **no silent fallback**.

### Runner precedence

The full precedence chain (first match wins):

| Priority | Source | How to set |
|---|---|---|
| 1 (highest) | Programmatic injection | `new Orchestrator({ runner: myRunner })` |
| 2 | `--runner <name>` flag | `ai-sdlc run --runner copilot` |
| 3 | `AI_SDLC_RUNNER_PLUGIN` | `export AI_SDLC_RUNNER_PLUGIN=/path/to/runner.mjs` |
| 4 (default) | `CopilotRunner` | _(always available)_ |

> **Plugin runners do not auto-select.** `AI_SDLC_RUNNER_PLUGIN` is an explicit opt-in seam and any additionally registered runner is selectable by name (`--runner <name>`). Absent an explicit `--runner`/`AI_SDLC_RUNNER_PLUGIN`/programmatic selection, the default is always `CopilotRunner`.

## Runner Registry

The `RunnerRegistry` manages discovery and selection of runners:

```typescript
import { createRunnerRegistry } from '@ai-sdlc/orchestrator';

const registry = createRunnerRegistry();

// List all available runners
const available = registry.listAvailable();
console.log(available.map(r => r.name));
// ['copilot']

// Get a specific runner
const runner = registry.get('copilot');

// Get the default runner (first available)
const defaultRunner = registry.getDefault();
```

### Auto-Discovery

`discoverFromEnv()` registers the built-in runner:

| Runner | Required Env Var(s) | Source |
|---|---|---|
| `copilot` | _(always available)_ | `built-in` |

Additional runners are registered explicitly via `register()` or the
`AI_SDLC_RUNNER_PLUGIN` seam.

### Manual Registration

You can register custom runners:

```typescript
import { RunnerRegistry } from '@ai-sdlc/orchestrator';

class MyCustomRunner implements AgentRunner {
  async run(ctx: AgentContext): Promise<AgentResult> {
    // Custom agent invocation logic
  }
}

const registry = new RunnerRegistry();
registry.register('my-agent', new MyCustomRunner());
```

## OpenShell Sandbox Integration

When the `sandboxId` field is set on `AgentContext`, CLI-based runners execute the agent inside an [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) sandbox. The runner prefixes the spawn command with `openshell sandbox connect <id> --`, so instead of:

```
copilot -p --model the balanced tier --allowedTools Edit,Write,...
```

it becomes:

```
openshell sandbox connect aisdlc-issue-42-1711316400 -- copilot -p --model the balanced tier --allowedTools Edit,Write,...
```

This provides kernel-level isolation (Landlock filesystem policies, seccomp syscall filtering, network policy enforcement) without any changes to the agent itself. The orchestrator's `executePipeline()` automatically passes `sandboxId` when a `SecurityContext` with an OpenShell sandbox is configured.

See [Security > OpenShell](./security.md#createopenshellsandboxexec-config) for setup details.

## Common Pattern

All CLI-based runners (GitHub Copilot CLI, Copilot, GitHub Copilot, GitHub Copilot) follow the same subprocess pattern:

1. **Build prompt** — `buildPrompt(ctx)` constructs a prompt from issue details, constraints, codebase context, and episodic memory
2. **Spawn CLI** — Run the agent CLI as a child process with appropriate flags
3. **Collect output** — Buffer stdout and stderr
4. **Parse token usage** — Extract input/output token counts from stderr for cost tracking
5. **Git diff** — Run `git diff --name-only` and `git ls-files --others` to find changed files
6. **Commit** — `git add -A` and `git commit` with the configured message template and co-author

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_SDLC_RUNNER_PLUGIN` | _(none)_ | Path to a custom runner plugin module (ESM/CJS, must export default or named `runner`). Fails fast on invalid module. |
| `AI_SDLC_MODEL` | `the balanced tier` | Model for CopilotRunner |
| `AI_SDLC_COPILOT_MODEL` | _(CLI default)_ | Model override for CopilotRunner |
| `AI_SDLC_CURSOR_MODEL` | _(CLI default)_ | Model override for CopilotRunner |
| `AI_SDLC_CODEX_MODEL` | _(CLI default)_ | Model override for CopilotRunner |
| `AI_SDLC_RUNNER_TIMEOUT` | `900000` (15 min) | Runner timeout in ms (supports duration strings) |
| `AI_SDLC_LINT_COMMAND` | _(none)_ | Lint command injected into agent prompts |
| `AI_SDLC_FORMAT_COMMAND` | _(none)_ | Format command injected into agent prompts |
| `AI_SDLC_COMMIT_MESSAGE_TEMPLATE` | `fix: resolve issue #{issueNumber}\n\n{issueTitle}` | Commit message template |
| `AI_SDLC_COMMIT_CO_AUTHOR` | `GitHub Copilot <noreply@github-models.com>` | Co-author for commits |
