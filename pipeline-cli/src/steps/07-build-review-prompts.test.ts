import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewPrompts } from './07-build-review-prompts.js';
import { cleanupTmpProject, makeTmpProject } from '../__test-helpers/make-task.js';
import { FakeRunner, ok } from '../__test-helpers/fake-runner.js';
import type { TaskSpec } from '../types.js';

let tmp: string;
beforeEach(() => {
  tmp = makeTmpProject();
});
afterEach(() => {
  cleanupTmpProject(tmp);
});

const task: TaskSpec = {
  id: 'AISDLC-1',
  title: 'demo',
  status: 'In Progress',
  acceptanceCriteria: ['a', 'b'],
  acceptanceCriteriaChecked: [false, false],
  description: 'demo desc',
  rawBody: '',
  filePath: '',
};

describe('Step 7 — buildReviewPrompts', () => {
  it('returns 3 reviewer prompts in canonical order', async () => {
    const fake = new FakeRunner()
      .on(/^git diff origin\/main\.\.\.HEAD$/, ok('--- diff content ---\n'))
      .on(/^git diff --name-only origin\/main\.\.\.HEAD$/, ok('a.ts\nb.ts\n'));
    const r = await buildReviewPrompts({
      taskId: 'AISDLC-1',
      task,
      branch: 'b',
      worktreePath: tmp,
      workDir: tmp,
      runner: fake.toRunner(),
      copilotAvailable: false,
    });
    expect(r.prompts).toHaveLength(3);
    expect(r.prompts.map((p) => p.reviewer)).toEqual([
      'code-reviewer',
      'test-reviewer',
      'security-reviewer',
    ]);
    expect(r.changedFiles).toEqual(['a.ts', 'b.ts']);
    expect(r.diff).toContain('diff content');
  });

  it('emits a harness warning when the copilot CLI is not available', async () => {
    const fake = new FakeRunner();
    const r = await buildReviewPrompts({
      taskId: 'AISDLC-1',
      task,
      branch: 'b',
      worktreePath: tmp,
      workDir: tmp,
      runner: fake.toRunner(),
      copilotAvailable: false,
    });
    expect(r.harnessNote).toMatch(/REVIEW HARNESS UNAVAILABLE/);
    expect(r.prompts[0].prompt).toMatch(/REVIEW HARNESS UNAVAILABLE/);
  });

  it('omits the harness warning when the copilot CLI is available', async () => {
    const fake = new FakeRunner();
    const r = await buildReviewPrompts({
      taskId: 'AISDLC-1',
      task,
      branch: 'b',
      worktreePath: tmp,
      workDir: tmp,
      runner: fake.toRunner(),
      copilotAvailable: true,
    });
    expect(r.harnessNote).toBe('');
    expect(r.prompts[0].prompt).not.toMatch(/REVIEW HARNESS UNAVAILABLE/);
  });

  it('includes review-policy.md content when present', async () => {
    mkdirSync(join(tmp, '.ai-sdlc'), { recursive: true });
    writeFileSync(join(tmp, '.ai-sdlc', 'review-policy.md'), 'POLICY: be strict');
    const fake = new FakeRunner();
    const r = await buildReviewPrompts({
      taskId: 'AISDLC-1',
      task,
      branch: 'b',
      worktreePath: tmp,
      workDir: tmp,
      runner: fake.toRunner(),
      copilotAvailable: true,
    });
    expect(r.prompts[0].prompt).toContain('POLICY: be strict');
  });

  it('autodetects the copilot CLI via `which`', async () => {
    const fake = new FakeRunner().on(/^which copilot/, ok('/usr/local/bin/copilot\n'));
    const r = await buildReviewPrompts({
      taskId: 'AISDLC-1',
      task,
      branch: 'b',
      worktreePath: tmp,
      workDir: tmp,
      runner: fake.toRunner(),
    });
    expect(r.harnessNote).toBe('');
  });
});
