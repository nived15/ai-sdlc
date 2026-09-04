/**
 * Hermetic tests for the canonical GitHub Copilot CLI bridge.
 *
 * These exercise the pure helpers only — the bridge never spawns a real
 * `copilot` process here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildArgs, safeExtraArgs, tryParseJson } from './copilot-spawn-agent-bridge.mjs';

describe('safeExtraArgs', () => {
  it('forwards --model and its value', () => {
    assert.deepEqual(safeExtraArgs(['--model', 'gpt-5']), ['--model', 'gpt-5']);
  });

  it('forwards the -m short form', () => {
    assert.deepEqual(safeExtraArgs(['-m', 'gpt-5-mini']), ['-m', 'gpt-5-mini']);
  });

  it('forwards --model=<value>', () => {
    assert.deepEqual(safeExtraArgs(['--model=gpt-5']), ['--model=gpt-5']);
  });

  it('strips tool-permission escalation attempts', () => {
    assert.deepEqual(safeExtraArgs(['--allow-all-tools', '--allow-tool', 'shell']), []);
  });

  it('strips --add-dir sandbox escapes', () => {
    assert.deepEqual(safeExtraArgs(['--add-dir', '/etc']), []);
  });

  it('tolerates non-string entries', () => {
    assert.deepEqual(safeExtraArgs([42, null, '--model', 'gpt-5']), ['--model', 'gpt-5']);
  });

  it('defaults to an empty list', () => {
    assert.deepEqual(safeExtraArgs(), []);
  });
});

describe('buildArgs', () => {
  it('gives the developer full tool access', () => {
    const args = buildArgs('developer');
    assert.ok(args.includes('--allow-all-tools'));
    assert.equal(args[args.length - 1], '-p');
  });

  it('denies write/edit/shell for reviewers', () => {
    for (const role of ['code-reviewer', 'test-reviewer', 'security-reviewer']) {
      const args = buildArgs(role);
      assert.ok(!args.includes('--allow-all-tools'), `${role} must not get --allow-all-tools`);
      const denied = args.filter((a, i) => args[i - 1] === '--deny-tool');
      assert.ok(denied.includes('write'), `${role} must deny write`);
      assert.ok(denied.includes('edit'), `${role} must deny edit`);
      assert.ok(denied.includes('shell'), `${role} must deny shell`);
    }
  });

  it('always disables colour and lowers log noise', () => {
    const args = buildArgs('developer');
    assert.ok(args.includes('--no-color'));
    assert.ok(args.includes('--log-level'));
  });

  it('places the safe extra args before the -p terminator', () => {
    const args = buildArgs('developer', ['--model', 'gpt-5']);
    assert.ok(args.indexOf('--model') < args.indexOf('-p'));
  });

  it('does not let extraArgs relax reviewer permissions', () => {
    const args = buildArgs('code-reviewer', ['--allow-all-tools']);
    assert.ok(!args.includes('--allow-all-tools'));
  });
});

describe('tryParseJson', () => {
  it('parses raw JSON', () => {
    assert.deepEqual(tryParseJson('{"approved":true}'), { approved: true });
  });

  it('parses fenced JSON', () => {
    assert.deepEqual(tryParseJson('```json\n{"approved":false}\n```'), { approved: false });
  });

  it('returns undefined for prose', () => {
    assert.equal(tryParseJson('looks good to me'), undefined);
  });

  it('returns undefined for empty input', () => {
    assert.equal(tryParseJson('   '), undefined);
  });
});
