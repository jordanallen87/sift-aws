import type { PackLens } from '@sift/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LensSwitcher } from './LensSwitcher.js';

const LENSES: PackLens[] = [
  {
    id: 'bid.lens.price',
    label: 'Price',
    description: 'What each bid costs once every bid prices the same work.',
    attributeIds: ['bid.quoted_total', 'bid.adjusted_total'],
  },
  {
    id: 'bid.lens.risk',
    label: 'Credentials & risk',
    description: 'Whether each bidder is licensed and insured for this scope.',
    attributeIds: ['bid.credentials_valid'],
  },
];

describe('LensSwitcher', () => {
  it('renders nothing at all for a pack that declares no lenses', () => {
    const { container } = render(
      <LensSwitcher lenses={[]} activeLensId={null} onLensChange={vi.fn()} />,
    );

    // Not an empty control with one inert option in it -- lenses are optional
    // on the manifest so a pack with nothing useful to group can decline.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('lens-switcher')).not.toBeInTheDocument();
  });

  it('offers every declared lens plus "All fields", in the author\'s own order', () => {
    render(<LensSwitcher lenses={LENSES} activeLensId={null} onLensChange={vi.fn()} />);

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim() ?? '')
      .filter((label) => label.length > 0);
    expect(labels).toEqual(['All fields', 'Price', 'Credentials & risk']);
  });

  it('reports the chosen lens id, and null for "All fields"', async () => {
    const onLensChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LensSwitcher lenses={LENSES} activeLensId="bid.lens.price" onLensChange={onLensChange} />,
    );

    await user.click(screen.getByTestId('lens-switcher-option-bid.lens.risk'));
    expect(onLensChange).toHaveBeenCalledWith('bid.lens.risk');

    // `null`, not an every-attribute list: clearing a lens must restore the
    // absent-`visibleAttributeIds` state a case has before anyone picks one.
    await user.click(screen.getByTestId('lens-switcher-option-all'));
    expect(onLensChange).toHaveBeenCalledWith(null);
  });

  it('marks exactly one option pressed, so the current lens is announced', () => {
    render(<LensSwitcher lenses={LENSES} activeLensId="bid.lens.risk" onLensChange={vi.fn()} />);

    expect(screen.getByTestId('lens-switcher-option-bid.lens.risk')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('lens-switcher-option-bid.lens.price')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('lens-switcher-option-all')).toHaveAttribute('aria-pressed', 'false');
  });

  it("shows the selected lens's own description, and none when showing all fields", () => {
    const { rerender } = render(
      <LensSwitcher lenses={LENSES} activeLensId="bid.lens.price" onLensChange={vi.fn()} />,
    );
    expect(screen.getByTestId('lens-switcher-description')).toHaveTextContent(
      'What each bid costs once every bid prices the same work.',
    );

    rerender(<LensSwitcher lenses={LENSES} activeLensId={null} onLensChange={vi.fn()} />);
    expect(screen.queryByTestId('lens-switcher-description')).not.toBeInTheDocument();
  });
});
