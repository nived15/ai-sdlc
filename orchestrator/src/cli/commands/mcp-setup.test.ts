/**
 * Tests for MCP server auto-detection and installation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAgents, installMcpServer, type DetectedAgent } from './mcp-setup.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-setup-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── detectAgents ────────────────────────────────────────────────────

describe('detectAgents', () => {
  it('always detects GitHub Copilot CLI', () => {
    const agents = detectAgents(tmpDir);
    const names = agents.map((a) => a.name);
    expect(names).toContain('GitHub Copilot CLI');
  });

  it('detects VS Code when .vscode/ directory exists', () => {
    mkdirSync(join(tmpDir, '.vscode'));
    const agents = detectAgents(tmpDir);
    const names = agents.map((a) => a.name);
    expect(names).toContain('VS Code');
  });

  it('never detects a third-party agent host', () => {
    mkdirSync(join(tmpDir, '.cursor'));
    mkdirSync(join(tmpDir, '.windsurf'));
    const agents = detectAgents(tmpDir);
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('Cursor');
    expect(names).not.toContain('GitHub Copilot');
    expect(names).toContain('GitHub Copilot CLI');
  });

  it('returns correct config paths and keys', () => {
    mkdirSync(join(tmpDir, '.vscode'));

    const agents = detectAgents(tmpDir);
    const map = new Map(agents.map((a) => [a.name, a]));

    expect(map.get('GitHub Copilot CLI')?.configPath).toBe('.mcp.json');
    expect(map.get('GitHub Copilot CLI')?.configKey).toBe('mcpServers');

    expect(map.get('VS Code')?.configPath).toBe('.vscode/mcp.json');
    expect(map.get('VS Code')?.configKey).toBe('servers');
  });

  it('pins mcp-advisor to the supplied version in the npx args', () => {
    const agents = detectAgents(tmpDir, { pinVersion: '0.6.0' });
    const copilot = agents.find((a) => a.name === 'GitHub Copilot CLI');
    expect(copilot).toBeDefined();
    const args = (copilot!.serverEntry as { args: string[] }).args;
    expect(args).toEqual(['-y', '@ai-sdlc/mcp-advisor@0.6.0']);
    // The pin-opt-out comment is now written at the top level of the MCP
    // config file (see installMcpServer tests below), not inside each
    // server entry. So the entry itself must NOT carry the comment.
    expect((copilot!.serverEntry as { _aiSdlcComment?: string })._aiSdlcComment).toBeUndefined();
  });

  it('omits the pin when no version is supplied (back-compat)', () => {
    const agents = detectAgents(tmpDir);
    const copilot = agents.find((a) => a.name === 'GitHub Copilot CLI');
    expect(copilot).toBeDefined();
    const args = (copilot!.serverEntry as { args: string[] }).args;
    expect(args).toEqual(['-y', '@ai-sdlc/mcp-advisor']);
  });
});

// ── installMcpServer ────────────────────────────────────────────────

describe('installMcpServer', () => {
  const copilotAgent: DetectedAgent = {
    name: 'GitHub Copilot CLI',
    configPath: '.mcp.json',
    configKey: 'mcpServers',
    serverEntry: { command: 'npx', args: ['-y', '@ai-sdlc/mcp-advisor'] },
  };

  const nestedDirAgent: DetectedAgent = {
    name: 'VS Code',
    configPath: '.vscode/mcp.json',
    configKey: 'mcpServers',
    serverEntry: { command: 'npx', args: ['-y', '@ai-sdlc/mcp-advisor'] },
  };

  const vscodeAgent: DetectedAgent = {
    name: 'VS Code',
    configPath: '.vscode/mcp.json',
    configKey: 'servers',
    serverEntry: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    },
  };

  it('creates new config file from scratch', () => {
    const result = installMcpServer(tmpDir, copilotAgent, false);
    expect(result).toBe('created');

    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers['ai-sdlc']).toEqual({
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    });
  });

  it('creates parent directory when needed', () => {
    const result = installMcpServer(tmpDir, nestedDirAgent, false);
    expect(result).toBe('created');
    expect(existsSync(join(tmpDir, '.vscode', 'mcp.json'))).toBe(true);
  });

  it('merges into existing config file preserving other servers', () => {
    mkdirSync(join(tmpDir, '.vscode'));
    const existing = {
      mcpServers: {
        'other-server': { command: 'node', args: ['server.js'] },
      },
    };
    writeFileSync(join(tmpDir, '.vscode/mcp.json'), JSON.stringify(existing), 'utf-8');

    const result = installMcpServer(tmpDir, nestedDirAgent, false);
    expect(result).toBe('merged');

    const content = JSON.parse(readFileSync(join(tmpDir, '.vscode/mcp.json'), 'utf-8'));
    expect(content.mcpServers['other-server']).toEqual({
      command: 'node',
      args: ['server.js'],
    });
    expect(content.mcpServers['ai-sdlc']).toEqual({
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    });
  });

  it('skips when ai-sdlc entry already exists', () => {
    const existing = {
      mcpServers: {
        'ai-sdlc': { command: 'npx', args: ['-y', '@ai-sdlc/mcp-advisor'] },
      },
    };
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify(existing), 'utf-8');

    const result = installMcpServer(tmpDir, copilotAgent, false);
    expect(result).toBe('skipped');
  });

  it('uses servers key for VS Code config', () => {
    mkdirSync(join(tmpDir, '.vscode'));

    const result = installMcpServer(tmpDir, vscodeAgent, false);
    expect(result).toBe('created');

    const content = JSON.parse(readFileSync(join(tmpDir, '.vscode/mcp.json'), 'utf-8'));
    expect(content.servers['ai-sdlc']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    });
    expect(content.mcpServers).toBeUndefined();
  });

  it('dry-run does not write files', () => {
    const result = installMcpServer(tmpDir, copilotAgent, true);
    expect(result).toBe('created');
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(false);
  });

  it('dry-run returns merged for existing file without ai-sdlc', () => {
    const existing = {
      mcpServers: {
        'other-server': { command: 'node', args: ['server.js'] },
      },
    };
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify(existing), 'utf-8');

    const result = installMcpServer(tmpDir, copilotAgent, true);
    expect(result).toBe('merged');

    // File should not have been modified
    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers['ai-sdlc']).toBeUndefined();
  });

  it('handles malformed JSON file gracefully', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), '{ not valid json', 'utf-8');

    const result = installMcpServer(tmpDir, copilotAgent, false);
    expect(result).toBe('merged');

    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.mcpServers['ai-sdlc']).toEqual({
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    });
  });

  it('merges into existing file that has no configKey section yet', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({ someOtherKey: true }), 'utf-8');

    const result = installMcpServer(tmpDir, copilotAgent, false);
    expect(result).toBe('merged');

    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content.someOtherKey).toBe(true);
    expect(content.mcpServers['ai-sdlc']).toEqual({
      command: 'npx',
      args: ['-y', '@ai-sdlc/mcp-advisor'],
    });
  });

  it('writes the pin-opt-out comment at the top level when creating a new file', () => {
    installMcpServer(tmpDir, copilotAgent, false);
    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(typeof content._aiSdlcComment).toBe('string');
    expect(content._aiSdlcComment).toMatch(/Pinned to the orchestrator/);
    // And the per-entry comment must NOT be present.
    expect(content.mcpServers['ai-sdlc']._aiSdlcComment).toBeUndefined();
  });

  it('adds the top-level comment when merging into a file that lacks it', () => {
    writeFileSync(
      join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
      'utf-8',
    );
    installMcpServer(tmpDir, copilotAgent, false);
    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content._aiSdlcComment).toMatch(/Pinned to the orchestrator/);
    expect(content.mcpServers.other).toEqual({ command: 'x' });
  });

  it('preserves an existing top-level _aiSdlcComment instead of overwriting', () => {
    const userCustomised = 'My custom note about why this is pinned.';
    writeFileSync(
      join(tmpDir, '.mcp.json'),
      JSON.stringify({
        _aiSdlcComment: userCustomised,
        mcpServers: { other: { command: 'x' } },
      }),
      'utf-8',
    );
    installMcpServer(tmpDir, copilotAgent, false);
    const content = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'));
    expect(content._aiSdlcComment).toBe(userCustomised);
  });
});
