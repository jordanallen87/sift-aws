/**
 * The first-run guide: the same explanation the Help control gives, shown
 * without being asked for, once, when a person's first case opens.
 *
 * The project owner's framing: "instructions pop-up when the user starts a
 * new case ... tell the user how everything works AND how they should be
 * interacting with the model to get this done, with examples." The second
 * half is the reason this exists. A passive "?" is only found by someone
 * who already knows they are lost, and nothing on the page hints that
 * saying "what's driving the ranking?" to an assistant does anything at
 * all.
 *
 * ## It is not a second explanation
 *
 * Every word of the body comes from `HowSiftWorks.tsx`, which
 * `HelpButton.tsx` also renders. This component contributes exactly two
 * things the Help sheet does not: it appears on its own, and it ends in an
 * explicit "Got it" so dismissing is a decision rather than a guess at
 * where to click. Content drift between the proactive and the on-demand
 * surface is impossible because there is only one copy of the content.
 *
 * ## Why `Sheet` rather than a hand-rolled modal
 *
 * `ui/sheet.tsx` is Radix Dialog underneath, which supplies focus trapping,
 * Escape, outside-click dismissal, `role="dialog"`, scroll locking and
 * focus restoration -- all of them required here and none of them worth
 * reimplementing. It is also already responsive in the two shapes this
 * product renders at: a bottom sheet at the canonical <=480px pane, a
 * centred dialog past 481px (see that file's own header comment), so this
 * reads correctly at 390px, at ChatGPT's real 640px side pane, and at
 * 1440px without a variant decision here.
 *
 * `onOpenChange` funnels every exit -- the close ✕, Escape, an overlay
 * click, and the "Got it" button -- through the one `onDismiss` callback,
 * so there is no path out of this overlay that forgets to record it.
 */
import type { RefObject } from 'react';
import type { PackCompliance } from '@sift/contracts';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  HOW_SIFT_WORKS_SUMMARY,
  HOW_SIFT_WORKS_TITLE,
  HowSiftWorksContent,
} from './HowSiftWorks.js';

export interface FirstRunGuideProps {
  /** Controlled by `App.tsx`, which decides (once per browser) that this should appear. */
  readonly open: boolean;
  /** Called for every exit path. `App.tsx` closes the guide and records the dismissal here. */
  readonly onDismiss: () => void;
  /**
   * Where keyboard focus goes when the guide closes. `App.tsx` points this
   * at the app bar's Help control.
   *
   * Needed because this dialog opens on its own rather than from a trigger.
   * Radix restores focus to whatever was focused when it opened, which here
   * is the launcher button the person clicked to start the case -- and that
   * button is unmounted by the time the guide appears. Measured in a real
   * browser: focus landed on `<body>`, so a keyboard user who dismissed the
   * guide had to Tab from the top of the document to reach anything.
   *
   * The Help control is the right destination rather than an arbitrary
   * first control: it is always mounted while a case is open, and it is
   * exactly where the content just dismissed can be found again.
   *
   * Optional, and a null ref falls through to Radix's own behaviour, so a
   * caller that has nothing to hand back to is never worse off.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
  /**
   * The active case's declared compliance content, forwarded straight to
   * `HowSiftWorksContent`. Optional: this guide can open before the active
   * case's pack has finished loading, in which case there is nothing yet to
   * show and the section this renders simply does not appear -- see
   * `HowSiftWorksContentProps.compliance`'s own doc comment.
   */
  readonly compliance?: PackCompliance | null | undefined;
}

export function FirstRunGuide({ open, onDismiss, returnFocusTo, compliance }: FirstRunGuideProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <SheetContent
        data-testid="first-run-guide"
        side="bottom"
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo?.current;
          if (target === null || target === undefined) return;
          event.preventDefault();
          target.focus();
          // Re-assert once on the next frame. This sheet closes while the
          // workspace is still streaming its first case events, and a
          // re-render landing immediately after Radix's close-autofocus can
          // drop focus back to `<body>` -- leaving a keyboard user nowhere,
          // with no visible cause. Observed as an intermittent
          // `first-run-guide.spec.ts` failure where the Help control is
          // demonstrably mounted (the locator resolves) and simply never
          // holds focus; it reproduces only under load, at a different
          // viewport each time.
          //
          // Deliberately one frame and one re-assert, guarded on the
          // element still being connected and not already focused: enough
          // to survive a single competing render, and incapable of fighting
          // a person who has deliberately focused something else in the
          // meantime.
          requestAnimationFrame(() => {
            if (target.isConnected && document.activeElement !== target) {
              target.focus();
            }
          });
        }}
      >
        <SheetHeader>
          <SheetTitle>{HOW_SIFT_WORKS_TITLE}</SheetTitle>
          <SheetDescription>{HOW_SIFT_WORKS_SUMMARY}</SheetDescription>
        </SheetHeader>
        <SheetBody
          /*
           * `tabIndex`/`role`/`aria-label` on the scrolling body, not
           * decoration: this panel's content is entirely static prose with
           * no focusable element inside it, so without a tab stop of its
           * own a keyboard-only user could not scroll it at all. Caught by
           * the real axe scan in `tests/e2e/first-run-guide.spec.ts`
           * (`scrollable-region-focusable`, WCAG 2.1.1/2.1.3, serious), not
           * by inspection. The name comes from the shared title constant so
           * the region announces itself with the same words the sheet's own
           * heading uses.
           */
          tabIndex={0}
          role="region"
          aria-label={HOW_SIFT_WORKS_TITLE}
        >
          <HowSiftWorksContent compliance={compliance} />
        </SheetBody>
        {/*
          A `shrink-0` footer OUTSIDE `SheetBody`, so the dismiss control is
          on screen the moment the guide opens rather than at the end of a
          scroll. `SheetBody` is the only scrolling region in the panel
          (`ui/sheet.tsx`), and at 390px this content is comfortably taller
          than 85vh -- a "Got it" that has to be scrolled to is a "Got it"
          that gets replaced by a guess at the ✕.
        */}
        <div className="shrink-0 border-t border-[color:var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)]">
          <Button
            type="button"
            data-testid="first-run-guide-dismiss"
            onClick={onDismiss}
            className="min-h-[var(--size-touch-target-min)] w-full"
          >
            Got it
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
