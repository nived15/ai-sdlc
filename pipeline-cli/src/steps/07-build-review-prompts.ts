/**
 * Step 7 — Build review prompts (3 reviewers — code, test, security).
 *
 * Mirrors `execute-orchestrator.md` Step 7. Captures the PR diff + changed
 * file list, detects whether the `copilot` CLI is installed (dispatch
 * harness), and produces three reviewer-specific prompt strings that can be
 * fed to three parallel `SubagentSpawner.spawn()` calls (Tier 2) or three
 * parallel agent invocations (Tier 1).
 *
 * The three reviewer subagents themselves run via the LLM dispatch boundary
 * (Step 7b) which is NOT part of this step.
 *
 * @module steps/07-build-review-prompts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRunner, type Runner } from '../runtime/exec.js';
import type { BuildReviewPromptsResult, ReviewPrompt, ReviewerType, TaskSpec } from '../types.js';

export interface BuildReviewPromptsOptions {
  taskId: string;
  task: TaskSpec;
  branch: string;
  worktreePath: string;
  workDir: string;
  runner?: Runner;
  /** Override the copilot-CLI availability detection (test injection). */
  copilotAvailable?: boolean;
}

const REVIEWERS: ReviewerType[] = ['code-reviewer', 'test-reviewer', 'security-reviewer'];

export async function buildReviewPrompts(
  opts: BuildReviewPromptsOptions,
): Promise<BuildReviewPromptsResult> {
  const runner = opts.runner ?? defaultRunner;

  const diffResult = await runner('git', ['diff', 'origin/main...HEAD'], {
    cwd: opts.worktreePath,
    allowFailure: true,
  });
  const diff = diffResult.code === 0 ? diffResult.stdout : '';

  const filesResult = await runner('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: opts.worktreePath,
    allowFailure: true,
  });
  const changedFiles =
    filesResult.code === 0
      ? filesResult.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      : [];

  // Dispatch-harness detection: the reviewers run through the GitHub Copilot CLI.
  let copilotAvailable = opts.copilotAvailable;
  if (copilotAvailable === undefined) {
    try {
      const which = await runner('which', ['copilot'], { allowFailure: true });
      copilotAvailable = which.code === 0 && which.stdout.trim().length > 0;
    } catch {
      copilotAvailable = false;
    }
  }
  const harnessNote = copilotAvailable
    ? ''
    : '⚠ REVIEW HARNESS UNAVAILABLE (GitHub Copilot CLI not found on PATH)';

  // Optional review policy from .ai-sdlc/review-policy.md (project-specific calibration)
  const policyPath = join(opts.workDir, '.ai-sdlc', 'review-policy.md');
  const policy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';

  const acList = opts.task.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n');

  const prompts: ReviewPrompt[] = REVIEWERS.map((reviewer) => ({
    reviewer,
    prompt: buildPrompt(reviewer, {
      taskId: opts.taskId,
      title: opts.task.title,
      description: opts.task.description,
      acList,
      diff,
      changedFiles,
      branch: opts.branch,
      policy,
      harnessNote,
    }),
  }));

  return { prompts, diff, changedFiles, harnessNote };
}

interface PromptInputs {
  taskId: string;
  title: string;
  description: string;
  acList: string;
  diff: string;
  changedFiles: string[];
  branch: string;
  policy: string;
  harnessNote: string;
}

function buildPrompt(reviewer: ReviewerType, inputs: PromptInputs): string {
  const policyBlock = inputs.policy
    ? `\n## Project review policy (.ai-sdlc/review-policy.md)\n\n${inputs.policy}\n`
    : '';
  const harnessBlock = inputs.harnessNote ? `\n${inputs.harnessNote}\n` : '';
  const filesBlock = inputs.changedFiles.length
    ? inputs.changedFiles.map((f) => `- ${f}`).join('\n')
    : '(none)';

  return (
    `You are the ${reviewer} for backlog task ${inputs.taskId}.\n\n` +
    `## Task\n${inputs.title}\n\n` +
    `## Description\n${inputs.description}\n\n` +
    `## Acceptance criteria\n${inputs.acList}\n\n` +
    `## Branch / base\nbranch: ${inputs.branch} → main\n\n` +
    `## Changed files\n${filesBlock}\n` +
    policyBlock +
    harnessBlock +
    `\n## Diff\n\n\`\`\`diff\n${inputs.diff}\n\`\`\`\n\n` +
    `Return a verdict JSON: { approved: boolean, findings: [...], summary: string }.\n`
  );
}
