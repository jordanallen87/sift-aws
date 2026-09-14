/**
 * A persistent "?" help affordance, rendered once at the top of every
 * top-level screen (`DemoLauncher`, `VehicleCatalogFlow`, `CaseHeader`,
 * `WorkspaceAppBar`) so a first-time visitor -- or a judge who lands on the
 * deployed URL cold -- always has an immediate, in-app answer to "what is
 * this and how do I use it," without needing the README. Fully
 * self-contained (uncontrolled `Sheet` -- Radix's own `Root`/`Trigger` own
 * the open state, matching this file's single static-content use case) so
 * every caller can drop it in with no props and no lifted state, unlike
 * `FindingsSheet`/the Runtime Inspector sheet, which are controlled because
 * they render live case data `App.tsx` itself owns.
 *
 * ## This is the "show me again" path, not the only one
 *
 * `FirstRunGuide` shows the identical content, unprompted, on a person's
 * first case in this browser. A "?" is only clicked by someone who already
 * knows they are lost; the first-run guide reaches the person who does not
 * yet know what they do not know. Both render `HowSiftWorks.tsx`, which is
 * where every word of the explanation now lives.
 *
 * That factoring is a repair, not tidiness. The copy that used to be
 * inlined here had gone stale in the one place a lost person looks: it told
 * people to click "Request investigation," a control renamed to "Ask Sift
 * to look into this" (`RecommendationHero.tsx`); it described "Compare
 * vehicles" as browsing an "offline" catalog, a word that appears nowhere
 * in the product; and its WebMCP paragraph promised that "every control
 * here also works from a WebMCP-enabled agent host" in every browser,
 * including the overwhelming majority that have no WebMCP host at all. One
 * shared content module means a rename can only be wrong once, and the
 * shared module reads the real `adapter.supported()` signal rather than
 * asserting a capability.
 */
import type { Ref } from 'react';
import type { PackCompliance } from '@sift/contracts';
import { CircleQuestionMarkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  HOW_SIFT_WORKS_SUMMARY,
  HOW_SIFT_WORKS_TITLE,
  HowSiftWorksContent,
} from './HowSiftWorks.js';

/**
 * The tooltip's second line -- see `WorkspaceAppBar.tsx`'s header comment
 * ("Third post-ship repair: tooltips say what a control DOES, not just its
 * name") for the full design rationale this follows. `HelpButton` is not
 * itself part of that file (it is reused verbatim across several top-level
 * screens, per this file's own header comment), so its description lives
 * here rather than being threaded through as a new prop.
 */
const HELP_DESCRIPTION = 'What Sift does and how to use it.';

export interface HelpButtonProps {
  /**
   * Optional handle on the underlying trigger button.
   *
   * `App.tsx` uses it as `FirstRunGuide`'s focus-return target: that dialog
   * opens on its own, so Radix has no trigger to hand focus back to and
   * (measured in a real browser) left it on `<body>`. This control is the
   * right destination -- it is always mounted while a case is open, and it
   * reopens the very content that was just dismissed. Every other caller
   * still drops `<HelpButton />` in with no props at all.
   */
  readonly ref?: Ref<HTMLButtonElement>;
  /**
   * The active case's declared compliance content, forwarded straight to
   * `HowSiftWorksContent`. Optional and omitted by the two callers that
   * render this before any case exists (`VehicleCatalogFlow`,
   * `DemoLauncher`) -- see `HowSiftWorksContentProps.compliance`'s own doc
   * comment for the full reasoning and the "render nothing" behavior an
   * absent value produces.
   */
  readonly compliance?: PackCompliance | null | undefined;
  /**
   * The active case's Decision Pack id, forwarded straight to
   * `HowSiftWorksContent` so "Talking to your assistant" shows examples
   * shaped for the pack actually on screen. Optional for the same reason
   * `compliance` is: the two callers that render this before any case
   * exists have no pack id to give it, and omitting it correctly falls
   * back to the default example set -- see
   * `HowSiftWorksContentProps.packId`'s own doc comment.
   */
  readonly packId?: string | null | undefined;
}

export function HelpButton({ ref, compliance, packId }: HelpButtonProps = {}) {
  return (
    <Sheet>
      {/*
       * The tooltip's first line repeats the `aria-label` that already names
       * this button verbatim (WCAG 2.5.3, "Label in Name" -- the same
       * convention `ui/tooltip.tsx` and `WorkspaceAppBar.tsx` both document
       * at length), so voice control and the visible name can never drift.
       * The second line is new information -- what the sheet this opens
       * actually contains -- and reaches assistive tech the same
       * `aria-describedby` way the first line always did, never as a second
       * accessible name (see `ui/tooltip.tsx`'s header comment). Joined as
       * one string with a real `\n`, not two sibling elements: verified
       * against this app's own `toHaveAccessibleDescription` stack that two
       * adjacent nodes with no literal character between them compute to a
       * description with no space at all, so a plain string join is the
       * technique that is correct by construction (see `WorkspaceAppBar.tsx`
       * "Third post-ship repair" for the full probe). This control is
       * unchanged for the touch and screen-reader users who never see the
       * tooltip open at all. `side="bottom"`: every caller renders this in
       * the top row of the pane, where a top-side tooltip would immediately
       * be flipped by collision handling anyway.
       */}
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              ref={ref}
              type="button"
              data-testid="help-button"
              aria-label="Help and instructions"
              variant="ghost"
              size="icon"
              className="min-h-[var(--size-touch-target-min)] min-w-[var(--size-touch-target-min)] shrink-0 text-muted-foreground hover:text-foreground"
            >
              <CircleQuestionMarkIcon className="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="whitespace-pre-line">
          {`Help and instructions\n${HELP_DESCRIPTION}`}
        </TooltipContent>
      </Tooltip>
      <SheetContent data-testid="help-sheet" side="bottom">
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
          <HowSiftWorksContent compliance={compliance} packId={packId} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
