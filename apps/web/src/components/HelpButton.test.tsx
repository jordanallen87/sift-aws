import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { HelpButton } from './HelpButton.js';
import { ASSISTANT_PHRASES, HOW_SIFT_WORKS_TITLE } from './HowSiftWorks.js';

describe('HelpButton', () => {
  it('renders a labeled help trigger and no sheet content until opened', () => {
    render(<HelpButton />);
    expect(screen.getByTestId('help-button')).toHaveAccessibleName('Help and instructions');
    expect(screen.queryByTestId('help-sheet')).not.toBeInTheDocument();
  });

  it('opens the help sheet with instructions when clicked', async () => {
    const user = userEvent.setup();
    render(<HelpButton />);

    await user.click(screen.getByTestId('help-button'));

    const sheet = await screen.findByTestId('help-sheet');
    expect(within(sheet).getByText(HOW_SIFT_WORKS_TITLE)).toBeInTheDocument();
    expect(within(sheet).getByText('Compare vehicles')).toBeInTheDocument();
    // The real current label (`RecommendationHero.tsx`). This assertion read
    // "Request investigation" for as long as that button had been renamed --
    // the exact drift the shared `HowSiftWorks` module exists to prevent.
    expect(within(sheet).getByText('Ask Sift to look into this')).toBeInTheDocument();
    expect(within(sheet).getByText('Inspect run')).toBeInTheDocument();
    expect(within(sheet).getByTestId('how-sift-works-phrases-lead')).toHaveTextContent(/WebMCP/);
  });

  it('renders the same assistant phrases the first-run guide does, from the one shared source', async () => {
    const user = userEvent.setup();
    render(<HelpButton />);

    await user.click(screen.getByTestId('help-button'));
    const sheet = await screen.findByTestId('help-sheet');

    for (const entry of ASSISTANT_PHRASES) {
      expect(within(sheet).getByText(`“${entry.phrase}”`)).toBeInTheDocument();
    }
  });

  it('states the human-only authority boundary', async () => {
    const user = userEvent.setup();
    render(<HelpButton />);

    await user.click(screen.getByTestId('help-button'));
    const sheet = await screen.findByTestId('help-sheet');

    expect(within(sheet).getByTestId('how-sift-works-authority')).toHaveTextContent(
      /cannot approve/i,
    );
  });

  it('closes the help sheet when its close control is used', async () => {
    const user = userEvent.setup();
    render(<HelpButton />);

    await user.click(screen.getByTestId('help-button'));
    expect(await screen.findByTestId('help-sheet')).toBeInTheDocument();

    await user.click(screen.getByTestId('sheet-close'));
    expect(screen.queryByTestId('help-sheet')).not.toBeInTheDocument();
  });

  it('forwards a supplied compliance value into the sheet\'s "What gets checked" section', async () => {
    const user = userEvent.setup();
    render(
      <HelpButton
        compliance={{
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
        }}
      />,
    );

    await user.click(screen.getByTestId('help-button'));
    const sheet = await screen.findByTestId('help-sheet');
    expect(within(sheet).getByTestId('how-sift-works-compliance')).toBeInTheDocument();
    expect(within(sheet).getByText('Sample standard')).toBeInTheDocument();
  });

  it('renders no "What gets checked" section when no compliance is supplied (the default)', async () => {
    const user = userEvent.setup();
    render(<HelpButton />);

    await user.click(screen.getByTestId('help-button'));
    const sheet = await screen.findByTestId('help-sheet');
    expect(within(sheet).queryByTestId('how-sift-works-compliance')).not.toBeInTheDocument();
  });

  it('has no axe violations closed or open', async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpButton />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByTestId('help-button'));
    await screen.findByTestId('help-sheet');
    expect(await axe(container)).toHaveNoViolations();
  });
});
