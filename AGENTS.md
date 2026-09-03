# AGENTS.md

Operating conventions for any agent working in this repository.

**Canonical source:** [`.github/copilot-instructions.md`](.github/copilot-instructions.md).
Read it before doing any work — it covers git flow, branch and commit
conventions, pre-push hooks, attestation requirements, the backlog workflow,
Pattern-C worktree isolation, and plugin MCP routing.

## The short version

- **Harness:** AI-SDLC dispatches every subagent through the **GitHub Copilot
  CLI**. `--spawner copilot` is the only production spawner; `mock` exists for
  plumbing tests. See [`docs/operations/copilot-spawner.md`](docs/operations/copilot-spawner.md).
- **Never merge PRs.** Only humans do. `gh pr merge` is off-limits.
- **Always rebase** feature branches onto `main`. Never merge `main` in.
- **Pattern C:** the parent working tree is read-only. All code work happens in
  `.worktrees/<task-id>/`.
- **Attestation is required** on `main`. Code PRs that touch source must carry a
  DSSE envelope covering all three reviewer roles. Docs-only PRs bypass.
- **Cross-repo writes** go through `permittedExternalPaths` in the task
  frontmatter.
- Run `pnpm build && pnpm test && pnpm lint && pnpm format:check` before pushing.

## Scoped instructions

Some directories carry their own `AGENTS.md` with additional rules. Read the one
closest to the code you are changing:

- [`spec/AGENTS.md`](spec/AGENTS.md)
- [`docs/api-reference/AGENTS.md`](docs/api-reference/AGENTS.md)
