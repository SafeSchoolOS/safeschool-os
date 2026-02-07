/**
 * Auth provider factory — returns Clerk plugin or JWT plugin based on AUTH_PROVIDER env.
 * AUTH_PROVIDER=clerk → Clerk session token verification
 * AUTH_PROVIDER=dev (default) → Simple JWT (email-only login, no password)
 */
export async function createAuthPlugin(): Promise<any> {
  const provider = process.env.AUTH_PROVIDER || 'dev';

  if (provider === 'clerk') {
    const { default: clerkPlugin } = await import('./clerk-auth.js');
    return clerkPlugin;
  }

  // Default: dev JWT plugin
  const { default: jwtPlugin } = await import('./auth.js');
  return jwtPlugin;
}
