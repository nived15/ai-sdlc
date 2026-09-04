/**
 * Runtime barrel — exports the SubagentSpawner interface + MockSpawner +
 * the GitHub Copilot production spawner (`CopilotHarnessAdapter`) + the
 * `defaultSpawner()` resolver, plus the Runner abstraction (and
 * defaultRunner) that every step accepts for shelling out to git/gh/etc.
 *
 * Phase 5 consumers (e.g. dogfood/watch.ts) import `Runner` / `defaultRunner`
 * / `ExecResult` / `ExecOptions` from here so they can extend or wrap
 * execution without reaching into deep paths.
 */
export * from './subagent-spawner.js';
export * from './default-spawner.js';
export * from './exec.js';
// AISDLC-429.2 — GitHub Copilot harness adapter (the framework's only
// production spawner).
export * from './spawners/copilot-harness.js';
// AISDLC-460 — CI-failure watcher (auto-rebase agent + cool-down + dedup comment).
export * from './ci-failure-watcher.js';
