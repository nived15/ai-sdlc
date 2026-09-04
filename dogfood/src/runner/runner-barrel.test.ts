import { describe, it, expect } from 'vitest';
import * as runner from './index.js';

describe('runner barrel exports', () => {
  it('exports CopilotRunner', () => {
    expect(runner.CopilotRunner).toBeTypeOf('function');
  });
});
