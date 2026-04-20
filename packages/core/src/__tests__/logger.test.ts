import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock pino before importing the logger module, since the root
// logger is created at import time.

const mockChild = vi.fn();
const mockPino = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: mockChild,
}));

vi.mock('pino', () => ({
  default: mockPino,
}));

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset child mock to return a fresh logger-like object each call
    mockChild.mockImplementation((bindings: Record<string, unknown>) => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      ...bindings,
    }));
  });

  it('should create a root pino logger on import', async () => {
    // Re-import to trigger module initialization
    const { logger } = await import('../logger.js');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('createLogger should return a child logger with component binding', async () => {
    const { createLogger } = await import('../logger.js');
    const childLogger = createLogger('test-component');
    expect(mockChild).toHaveBeenCalledWith({ component: 'test-component' });
    expect(childLogger).toBeDefined();
  });

  it('createLogger should pass component name in bindings', async () => {
    const { createLogger } = await import('../logger.js');
    createLogger('sync-engine');
    expect(mockChild).toHaveBeenCalledWith({ component: 'sync-engine' });
  });

  it('child logger should have standard log methods', async () => {
    const { createLogger } = await import('../logger.js');
    const child = createLogger('my-module');
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.debug).toBe('function');
  });

  it('should create distinct child loggers for different components', async () => {
    const { createLogger } = await import('../logger.js');
    const logger1 = createLogger('component-a');
    const logger2 = createLogger('component-b');
    expect(mockChild).toHaveBeenCalledTimes(2);
    expect(mockChild).toHaveBeenCalledWith({ component: 'component-a' });
    expect(mockChild).toHaveBeenCalledWith({ component: 'component-b' });
  });
});
