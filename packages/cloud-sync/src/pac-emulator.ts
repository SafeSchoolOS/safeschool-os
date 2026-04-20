/**
 * PAC emulator — stubbed in public release.
 *
 * The full PAC emulator simulates multiple access-control vendor systems
 * for demos and load testing; it uses private vendor adapters. Public
 * builds get a no-op stub (no demo data seeding).
 */

export function startPacEmulator(..._args: unknown[]): { stop: () => void } | null {
  return null;
}

export function stopPacEmulator(..._args: unknown[]): void {
  return;
}

export async function generateDemoSeed(..._args: unknown[]): Promise<Record<string, unknown>> {
  return {};
}
