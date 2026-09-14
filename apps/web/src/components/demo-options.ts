/**
 * The launcher's "Or try a finished example" cards -- one definition,
 * shared by `DemoLauncher.tsx` (which renders them) and `HowSiftWorks.tsx`
 * (whose help copy names how many there are).
 *
 * Splitting this out of `DemoLauncher.tsx` is the fix for the count going
 * stale: the Help sheet used to hardcode "two ready-made cases" as a
 * literal string and silently fell out of sync the moment a third
 * (`bid-comparison`) was added. `HowSiftWorks.tsx` reads
 * `DEMO_OPTIONS.length` instead, so a fourth demo card can never repeat
 * that mistake.
 */
import type { DemoId } from '@sift/contracts';

export interface DemoOption {
  demoId: DemoId;
  testId: string;
  label: string;
  description: string;
}

export const DEMO_OPTIONS: readonly DemoOption[] = [
  // Bid comparison leads (Professional Agents track, ADR 0017): it is this
  // project's hero example now, so it is the first thing a visitor sees
  // under "Or try a finished example" rather than reading as an afterthought
  // behind the two earlier packs.
  {
    demoId: 'bid-comparison',
    testId: 'demo-launcher-bid-comparison',
    label: 'Compare these bids',
    description: 'Put subcontractor bids on the same footing before you award one.',
  },
  {
    demoId: 'car-purchase',
    testId: 'demo-launcher-car-purchase',
    label: 'Choose our next car',
    description: 'Compare shortlisted vehicles and dealer offers before you buy.',
  },
  {
    demoId: 'home-energy-guardian',
    testId: 'demo-launcher-home-energy-guardian',
    label: 'Investigate my energy bill',
    description: 'Find out why a utility bill changed and what to do about it.',
  },
];
