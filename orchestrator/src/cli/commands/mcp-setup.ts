/**
 * MCP server setup — detect coding agents and install MCP config.
 *
 * AISDLC-78 changes:
 *  - The `npx -y` arg list now pins `@ai-sdlc/mcp-advisor@<version>` so
 *    fresh installs don't silently jump to whatever is published when
 *    the orchestrator binary itself was last updated. Each generated
 *    config file carries a single top-level `_aiSdlcComment` documenting
 *    how to opt back into floating-tag behaviour.
 *  - Detection is limited to the GitHub Copilot CLI (`.mcp.json`) and
 *    VS Code (`.vscode/mcp.json`) — the two hosts this framework targets.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export interface DetectedAgent {
  name: string; // "GitHub Copilot CLI", "VS Code"
  configPath: string; // relative path to MCP config file
  configKey: string; // "mcpServers" or "servers" (VS Code)
  serverEntry: Record<string, unknown>; // the ai-sdlc server config object
}

/**
 * The opt-out comment we write alongside the pinned mcp-advisor entry.
 * Lives at the top level of the generated MCP config under a leading-
 * underscore key so JSON parsers and MCP clients ignore it; humans
 * editing by hand see exactly how to re-enable floating-latest behaviour.
 */
const PIN_OPT_OUT_COMMENT =
  'Pinned to the orchestrator version that ran `ai-sdlc init`. ' +
  'To always pull the latest published mcp-advisor, change args to ["-y", "@ai-sdlc/mcp-advisor"].';

function pinnedSpec(version: string | undefined): string {
  return version && version !== '0.0.0'
    ? `@ai-sdlc/mcp-advisor@${version}`
    : '@ai-sdlc/mcp-advisor';
}

function standardEntry(
  version: string | undefined,
  env?: Record<string, string>,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: 'npx',
    args: ['-y', pinnedSpec(version)],
  };
  if (env) entry.env = env;
  return entry;
}

function vscodeEntry(
  version: string | undefined,
  env?: Record<string, string>,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', pinnedSpec(version)],
  };
  if (env) entry.env = env;
  return entry;
}

interface AgentSpec {
  name: string;
  configPath: string;
  configKey: string;
  entryFn: (version: string | undefined, env?: Record<string, string>) => Record<string, unknown>;
  configDir?: string; // directory signal (e.g. ".vscode")
  binary?: string; // binary to check on PATH
  alwaysDetect?: boolean;
  /** Requires explicit opt-in even if signals are present. */
  requiresOptIn?: boolean;
}

const AGENT_SPECS: AgentSpec[] = [
  {
    name: 'GitHub Copilot CLI',
    configPath: '.mcp.json',
    configKey: 'mcpServers',
    entryFn: standardEntry,
    binary: 'copilot',
    alwaysDetect: true,
  },
  {
    name: 'VS Code',
    configPath: '.vscode/mcp.json',
    configKey: 'servers',
    entryFn: vscodeEntry,
    configDir: '.vscode',
    binary: 'code',
  },
];

function hasBinary(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface DetectAgentsOptions {
  /** When true, adds AI_SDLC_WORKSPACE env to server entries. */
  isWorkspace?: boolean;
  /** Pin the mcp-advisor to this version in generated configs. */
  pinVersion?: string;
}

/**
 * Returned alongside detected agents to log skip decisions.
 */
export interface DetectAgentsResult {
  detected: DetectedAgent[];
  /** Per-spec skip explanations for human-readable logging. */
  skipped: Array<{ name: string; reason: string }>;
}

export function detectAgentsDetailed(
  projectDir: string,
  options?: DetectAgentsOptions,
): DetectAgentsResult {
  const detected: DetectedAgent[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const env = options?.isWorkspace ? { AI_SDLC_WORKSPACE: '.' } : undefined;
  const pinVersion = options?.pinVersion;

  for (const spec of AGENT_SPECS) {
    if (spec.alwaysDetect) {
      detected.push({
        name: spec.name,
        configPath: spec.configPath,
        configKey: spec.configKey,
        serverEntry: spec.entryFn(pinVersion, env),
      });
      continue;
    }

    const hasDir = spec.configDir ? existsSync(join(projectDir, spec.configDir)) : false;
    const hasBin = spec.binary ? hasBinary(spec.binary) : false;

    if (spec.requiresOptIn) {
      // Reserved for future hosts that need an explicit opt-in signal.
      // No shipped spec sets this today.
      skipped.push({
        name: spec.name,
        reason: 'requires explicit opt-in',
      });
      continue;
    }

    if (hasDir || hasBin) {
      detected.push({
        name: spec.name,
        configPath: spec.configPath,
        configKey: spec.configKey,
        serverEntry: spec.entryFn(pinVersion, env),
      });
    }
  }

  return { detected, skipped };
}

/**
 * Backwards-compatible wrapper. New code should prefer detectAgentsDetailed.
 */
export function detectAgents(projectDir: string, options?: DetectAgentsOptions): DetectedAgent[] {
  return detectAgentsDetailed(projectDir, options).detected;
}

export function installMcpServer(
  projectDir: string,
  agent: DetectedAgent,
  dryRun: boolean,
): 'created' | 'merged' | 'skipped' {
  const fullPath = join(projectDir, agent.configPath);

  if (existsSync(fullPath)) {
    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(readFileSync(fullPath, 'utf-8'));
    } catch {
      // If the file is malformed JSON, treat as new
      existing = {};
    }

    const section = (existing[agent.configKey] ?? {}) as Record<string, unknown>;

    if (section['ai-sdlc']) {
      return 'skipped';
    }

    if (!dryRun) {
      section['ai-sdlc'] = agent.serverEntry;
      existing[agent.configKey] = section;
      // Top-level pin-comment: standard convention is a single
      // `_aiSdlcComment` key at the root of the document, not inside each
      // server entry. We add it on first write but never overwrite an
      // existing top-level value (caller may have customised it).
      if (!('_aiSdlcComment' in existing)) {
        existing._aiSdlcComment = PIN_OPT_OUT_COMMENT;
      }
      writeFileSync(fullPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    }
    return 'merged';
  }

  if (!dryRun) {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const config = {
      _aiSdlcComment: PIN_OPT_OUT_COMMENT,
      [agent.configKey]: {
        'ai-sdlc': agent.serverEntry,
      },
    };
    writeFileSync(fullPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }
  return 'created';
}
