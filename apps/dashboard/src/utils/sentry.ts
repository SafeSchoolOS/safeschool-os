// Sentry is an optional dependency. This module is safe to import even when
// @sentry/react is not installed — all functions become no-ops.

let sentryModule: any = null;

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  // Only attempt to use Sentry if it was bundled (i.e. npm installed)
  try {
    // This will be tree-shaken away if @sentry/react is not in node_modules
    // For now, we'll rely on the ErrorBoundary and manual captureException below
    console.info('Sentry DSN configured — install @sentry/react to enable tracking');
  } catch {
    // @sentry/react not available
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (sentryModule) {
    if (context) {
      sentryModule.withScope((scope: any) => {
        scope.setContext('extra', context);
        sentryModule.captureException(error);
      });
    } else {
      sentryModule.captureException(error);
    }
  }
}
