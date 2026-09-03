/**
 * Harness-neutral prompt construction for AI-SDLC agent runners.
 *
 * `buildPrompt()` turns an `AgentContext` (issue body, CI errors, review
 * findings, codebase context, constraints) into the instruction text handed
 * to a coding agent. It is deliberately free of any CLI-specific flags so
 * every runner in this package shares one prompt contract.
 *
 * `parseTokenUsage()` extracts token counts from a runner's stderr.
 */

import type { AgentContext, TokenUsage } from './types.js';
import { DEFAULT_LINT_COMMAND, DEFAULT_FORMAT_COMMAND } from '../defaults.js';
import { formatContextForPrompt } from '../analysis/context-builder.js';

/**
 * Build verification step instructions (lint, format, typecheck).
 * Returns an array of numbered step strings starting from the given step number.
 */
function buildVerificationSteps(
  startStep: number,
  lintCmd?: string,
  fmtCmd?: string,
  typecheckCmd?: string,
): { lines: string[]; nextStep: number } {
  let step = startStep;
  const lines: string[] = [];

  if (lintCmd && fmtCmd) {
    lines.push(
      `${++step}. After making code changes, run \`${lintCmd}\` and \`${fmtCmd}\` to catch issues before committing.`,
    );
  } else if (lintCmd) {
    lines.push(
      `${++step}. After making code changes, run \`${lintCmd}\` to catch issues before committing.`,
    );
  } else if (fmtCmd) {
    lines.push(
      `${++step}. After making code changes, run \`${fmtCmd}\` to catch issues before committing.`,
    );
  }

  if (typecheckCmd) {
    lines.push(
      `${++step}. IMPORTANT: Run \`${typecheckCmd}\` to verify there are no TypeScript errors. The pre-commit hook will reject your commit if there are type errors. Fix ALL type errors before committing.`,
    );
  }

  return { lines, nextStep: step };
}

export function buildPrompt(ctx: AgentContext): string {
  const lintCmd = ctx.lintCommand ?? DEFAULT_LINT_COMMAND;
  const fmtCmd = ctx.formatCommand ?? DEFAULT_FORMAT_COMMAND;
  const typecheckCmd = ctx.typecheckCommand;

  const lines = [
    `You are fixing issue ${/^\d+$/.test(ctx.issueId) ? '#' : ''}${ctx.issueId}: ${ctx.issueTitle}`,
    '',
    '## Issue Description',
    ctx.issueBody,
    '',
  ];

  if (ctx.ciErrors) {
    let step = 0;
    lines.push(
      '## CI Failure Logs',
      '',
      '```',
      ctx.ciErrors,
      '```',
      '',
      '## Instructions',
      `${++step}. Analyze the CI failure logs above to identify the root cause.`,
      `${++step}. Read the relevant source files to understand the context.`,
      `${++step}. Fix the errors that caused CI to fail.`,
    );
    if (fmtCmd) {
      lines.push(
        `${++step}. If the failure is a formatting/prettier error, run \`${fmtCmd}\` to auto-fix it.`,
      );
    }
    const ciVerify = buildVerificationSteps(step, lintCmd, fmtCmd, typecheckCmd);
    lines.push(...ciVerify.lines);
    step = ciVerify.nextStep;
    lines.push(
      `${++step}. Write or update tests if needed to cover your fix.`,
      `${++step}. NEVER modify files matching the blocked paths below — violations will be automatically detected and the change will be rejected.`,
      `${step + 1}. Keep your changes to at most ${ctx.constraints.maxFilesPerChange} files.`,
    );
  } else if (ctx.reviewFindings) {
    let step = 0;
    lines.push(
      '## Review Findings',
      '',
      ctx.reviewFindings,
      '',
      '## Instructions',
      `${++step}. Read the review findings above carefully.`,
      `${++step}. Read the relevant source files to understand the context.`,
      `${++step}. Address all the review findings by making necessary code changes.`,
      `${++step}. Write or update tests if requested by the reviewers.`,
    );
    const reviewVerify = buildVerificationSteps(step, lintCmd, fmtCmd, typecheckCmd);
    lines.push(...reviewVerify.lines);
    step = reviewVerify.nextStep;
    lines.push(
      `${++step}. NEVER modify files matching the blocked paths below — violations will be automatically detected and the change will be rejected.`,
      `${step + 1}. Keep your changes to at most ${ctx.constraints.maxFilesPerChange} files.`,
    );
  } else {
    let step = 0;
    lines.push(
      '## Instructions',
      `${++step}. Read the relevant source files to understand the codebase.`,
      `${++step}. Implement the fix or feature described in the issue.`,
      `${++step}. Write or update tests to cover your changes.`,
    );
    const defaultVerify = buildVerificationSteps(step, lintCmd, fmtCmd, typecheckCmd);
    lines.push(...defaultVerify.lines);
    step = defaultVerify.nextStep;
    lines.push(
      `${++step}. NEVER modify files matching the blocked paths below — violations will be automatically detected and the change will be rejected.`,
      `${step + 1}. Keep your changes to at most ${ctx.constraints.maxFilesPerChange} files.`,
    );
  }

  lines.push(
    '',
    '## Constraints (enforced — violations will be automatically rejected)',
    `- Maximum files to change: ${ctx.constraints.maxFilesPerChange}`,
    `- Tests required: ${ctx.constraints.requireTests}`,
    `- Blocked paths (NEVER modify — changes will be rejected): ${ctx.constraints.blockedPaths.join(', ') || 'none'}`,
  );

  // Append relevant episodic memory if available
  if (ctx.memory) {
    const episodes = ctx.memory.episodic.search(`issue-${ctx.issueId}`);
    if (episodes.length > 0) {
      lines.push('', '## Previous Context');
      for (const ep of episodes.slice(0, 5)) {
        const summary =
          ep.metadata && typeof ep.metadata === 'object' && 'summary' in ep.metadata
            ? (ep.metadata as Record<string, unknown>).summary
            : ep.key;
        lines.push(`- ${summary}`);
      }
    }
  }

  // Append episodic context if available
  if (ctx.episodicContext) {
    lines.push('', ctx.episodicContext);
  }

  // Append codebase context if available
  if (ctx.codebaseContext) {
    lines.push('', formatContextForPrompt(ctx.codebaseContext));
  }

  return lines.join('\n');
}

/**
 * Parse token usage from a runner's stderr output.
 * Agent CLIs emit token info to stderr in a few common shapes.
 */
export function parseTokenUsage(stderr: string, model: string): TokenUsage | undefined {
  // Try to match patterns like "Input tokens: 1234" / "Output tokens: 5678"
  const inputMatch = stderr.match(/input[\s_-]*tokens?[:\s]+(\d[\d,]*)/i);
  const outputMatch = stderr.match(/output[\s_-]*tokens?[:\s]+(\d[\d,]*)/i);

  if (inputMatch || outputMatch) {
    const cacheMatch = stderr.match(/cache[\s_-]*(?:read|hit)[\s_-]*tokens?[:\s]+(\d[\d,]*)/i);
    return {
      inputTokens: inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0,
      outputTokens: outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0,
      cacheReadTokens: cacheMatch ? parseInt(cacheMatch[1].replace(/,/g, ''), 10) : undefined,
      model,
    };
  }

  // Try to match total tokens pattern
  const totalMatch = stderr.match(/total[\s_-]*tokens?[:\s]+(\d[\d,]*)/i);
  if (totalMatch) {
    const total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    // Estimate 70% input / 30% output split
    return {
      inputTokens: Math.round(total * 0.7),
      outputTokens: Math.round(total * 0.3),
      model,
    };
  }

  return undefined;
}

