export {
  type HarnessAdapter,
  type HarnessAvailability,
  type HarnessCapabilities,
  type HarnessEvent,
  type HarnessInput,
  type HarnessName,
  type HarnessRequires,
  type HarnessResult,
  type HarnessResultStatus,
  type ToolDefinition,
} from './types.js';

export { HarnessRegistry, UnknownHarnessError } from './registry.js';

export { probeVersion, matchesRange } from './version-probe.js';

export {
  enforceIndependence,
  validateIndependenceGraph,
  CyclicIndependenceConstraintError,
  type IndependenceResult,
  type UpstreamRun,
} from './independence.js';

export { CopilotAdapter, type CopilotAdapterDeps } from './adapters/copilot.js';

import { HarnessRegistry } from './registry.js';
import { CopilotAdapter } from './adapters/copilot.js';

/**
 * Create a registry pre-populated with the GitHub Copilot adapter — the
 * framework's only supported coding-agent harness.
 */
export function createDefaultHarnessRegistry(): HarnessRegistry {
  const reg = new HarnessRegistry();
  reg.register(new CopilotAdapter());
  return reg;
}
