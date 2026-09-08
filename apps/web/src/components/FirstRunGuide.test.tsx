import { describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AppProviders } from '../app/AppProviders.js';
import { InMemoryModelContextAdapter } from '../model-context/adapter.js';
import type { FirstRunGuideProps } from './FirstRunGuide.js';
import { FirstRunGuide } from './FirstRunGuide.js';
import { ASSISTANT_PHRASES, HOW_SIFT_WORKS_TITLE } from './HowSiftWorks.js';

function renderGuide(
  open: boolean,
  onDismiss: () => void = vi.fn(),
  props: Partial<Omit<FirstRunGuideProps, 'open' | 'onDismiss'>> = {},
) {
  return render(
    <AppProviders webMcpAdapter={new InMemoryModelContextAdapter()}>
      <button type="button" data-testid="outside-trigger">
        outside
      </button>
      <FirstRunGuide open={open} onDismiss={onDismiss} {...props} />
    </AppProviders>,
  );
}

describe('FirstRunGuide', () => {
  it('renders nothing while closed', () => {
    renderGuide(false);
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('shows the shared "How Sift works" content when open', async () => {
    renderGuide(true);
    const guide = await screen.findByTestId('first-run-guide');
    expect(within(guide).getByText(HOW_SIFT_WORKS_TITLE)).toBeInTheDocument();
    expect(within(guide).getByTestId('how-sift-works-phrases')).toBeInTheDocument();
    expect(within(guide).getByText(`“${ASSISTANT_PHRASES[0]!.phrase}”`)).toBeInTheDocument();
  });

  it('dismisses through its explicit primary control', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderGuide(true, onDismiss);

    await user.click(await screen.findByTestId('first-run-guide-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderGuide(true, onDismiss);
    await screen.findByTestId('first-run-guide');

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a click outside the panel', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderGuide(true, onDismiss);
    await screen.findByTestId('first-run-guide');

    // The Radix overlay behind the panel -- a real outside click, not a
    // synthetic close call.
    await user.click(document.querySelector('[data-slot="sheet-overlay"]')!);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismisses through the sheet close control', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderGuide(true, onDismiss);
    await screen.findByTestId('first-run-guide');

    await user.click(screen.getByTestId('sheet-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the guide and traps it there', async () => {
    const user = userEvent.setup();
    renderGuide(true);
    const guide = await screen.findByTestId('first-run-guide');

    expect(guide.contains(document.activeElement)).toBe(true);
    // Tabbing repeatedly must never land on the button outside the dialog.
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(screen.getByTestId('outside-trigger'));
    }
  });

  it('is reachable and operable from the keyboard alone', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderGuide(true, onDismiss);
    await screen.findByTestId('first-run-guide');

    screen.getByTestId('first-run-guide-dismiss').focus();
    await user.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the control that can reopen it, not to the document body', async () => {
    const user = userEvent.setup();

    // A real controlled host, like `App.tsx`: `onDismiss` actually closes
    // the guide, which is what makes Radix run its close-focus handling at
    // all.
    function Harness() {
      const target = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <AppProviders webMcpAdapter={new InMemoryModelContextAdapter()}>
          <button type="button" data-testid="reopen" ref={target}>
            reopen
          </button>
          <FirstRunGuide
            open={open}
            onDismiss={() => {
              setOpen(false);
            }}
            returnFocusTo={target}
          />
        </AppProviders>
      );
    }

    render(<Harness />);
    await screen.findByTestId('first-run-guide');

    await user.click(screen.getByTestId('sheet-close'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('reopen'));
    });
  });

  it('has no axe violations while open', async () => {
    const { baseElement } = renderGuide(true);
    await screen.findByTestId('first-run-guide');
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('forwards a supplied compliance value into the "What gets checked" section', async () => {
    renderGuide(true, vi.fn(), {
      compliance: {
        disclaimer: 'Informational only.',
        standards: [
          {
            id: 'sample-standard',
            label: 'Sample standard',
            summary: 'A sample requirement.',
            citation: 'Sample Citation',
            authority: 'Sample Authority',
            humanResponsibility: 'Confirm this applies to your situation.',
          },
        ],
      },
    });
    const guide = await screen.findByTestId('first-run-guide');
    expect(within(guide).getByTestId('how-sift-works-compliance')).toBeInTheDocument();
    expect(within(guide).getByText('Sample standard')).toBeInTheDocument();
  });

  it('renders no "What gets checked" section when no compliance is supplied (the default)', async () => {
    renderGuide(true);
    const guide = await screen.findByTestId('first-run-guide');
    expect(within(guide).queryByTestId('how-sift-works-compliance')).not.toBeInTheDocument();
  });
});
