import type { VisitorScreeningAdapter, ScreeningInput, ScreeningAdapterResult } from '../index.js';

export class ConsoleScreeningAdapter implements VisitorScreeningAdapter {
  name = 'Console (Dev)';

  async screen(input: ScreeningInput): Promise<ScreeningAdapterResult> {
    console.log(`\n[SCREENING] Visitor: ${input.firstName} ${input.lastName}`);
    console.log(`  ID Type: ${input.idType || 'N/A'}`);
    console.log(`  Result: ALL CLEAR (dev mode)`);

    return {
      sexOffenderCheck: 'CLEAR',
      watchlistCheck: 'CLEAR',
      checkedAt: new Date(),
    };
  }
}
