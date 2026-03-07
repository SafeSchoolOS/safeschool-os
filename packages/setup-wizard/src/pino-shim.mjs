// No-op pino shim for the setup wizard bundle.
// The wizard never uses logging — this avoids bundling pino's native deps.
const noop = () => {};
const noopLogger = { info: noop, error: noop, warn: noop, debug: noop, trace: noop, fatal: noop, child: () => noopLogger, level: 'silent' };
const pino = () => noopLogger;
export default pino;
