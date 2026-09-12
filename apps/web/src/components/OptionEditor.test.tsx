import { describe, expect, it, vi } from 'vitest';
import { MAX_BID_DOCUMENT_BYTES, MAX_CASE_ENTITIES } from '@sift/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { AttributeDefinition, EntityRecord } from '@sift/contracts';
import { OptionEditor } from './OptionEditor.js';
import { AppProviders } from '../app/AppProviders.js';
import { createFakeSiftCommands, buildFakeCommandReceipt } from '../test/fake-sift-commands.js';
import { buildFixtureCaseState } from '../test/fixtures.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';

const ATTRIBUTE_DEFINITIONS: AttributeDefinition[] = [
  {
    id: 'price',
    label: 'Price',
    valueType: 'money',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
  },
  {
    id: 'mileage',
    label: 'Mileage',
    valueType: 'number',
    required: false,
    appliesTo: ['car'],
    unit: 'mi',
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
  },
];

function buildEntity(overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 'candidate-rav4',
    kind: 'car',
    label: 'Toyota RAV4',
    attributes: {
      price: {
        definitionId: 'price',
        label: 'Price',
        value: { type: 'money', amount: 28500, currency: 'USD' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(
  overrides: Partial<React.ComponentProps<typeof OptionEditor>> = {},
  commandsOverrides: Parameters<typeof createFakeSiftCommands>[0] = {},
) {
  const commands = createFakeSiftCommands(commandsOverrides);
  const utils = render(
    <AppProviders commandsClient={commands}>
      <OptionEditor
        caseId="case-1"
        resolveExpectedSequence={() => Promise.resolve(4)}
        optionKind="car"
        optionLabel="car"
        attributeDefinitions={ATTRIBUTE_DEFINITIONS}
        options={[]}
        {...overrides}
      />
    </AppProviders>,
  );
  return { ...utils, commands };
}

describe('OptionEditor', () => {
  it('renders the initial/empty state with no options yet', () => {
    renderEditor();
    expect(screen.getByTestId('option-editor-empty')).toBeInTheDocument();
  });

  // The roster is now collapsed by default (docs comment in OptionEditor.tsx:
  // the form is the task, the existing roster is reference material) --
  // opening it is what makes `option-editor-option-*`/`option-editor-edit-*`
  // exist in the DOM at all.
  it('lists existing options with an edit control for each, once the roster is expanded', async () => {
    const user = userEvent.setup();
    renderEditor({ options: [buildEntity()] });

    expect(screen.queryByTestId('option-editor-option-candidate-rav4')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('option-editor-list-trigger'));

    expect(screen.getByTestId('option-editor-option-candidate-rav4')).toHaveTextContent(
      'Toyota RAV4',
    );
    expect(screen.getByTestId('option-editor-edit-candidate-rav4')).toBeInTheDocument();
  });

  it('renders a DynamicAttributeField for every pack-declared attribute applicable to this option kind', () => {
    renderEditor();
    expect(screen.getByTestId('dynamic-attribute-field-price')).toBeInTheDocument();
    expect(screen.getByTestId('dynamic-attribute-field-mileage')).toBeInTheDocument();
  });

  it('saves a new option by calling upsertOption on the shared SiftCommands client', async () => {
    const receipt = buildFakeCommandReceipt({ caseId: 'case-1' });
    const user = userEvent.setup();
    const { commands } = renderEditor({}, { upsertOption: vi.fn().mockResolvedValue(receipt) });

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(commands.upsertOption).toHaveBeenCalledTimes(1);
    });
    // `toMatchObject` recursively partial-matches nested objects on its own,
    // so the nested `option` need not be wrapped in a second
    // `expect.objectContaining(...)` -- avoids this repo's strict
    // `no-unsafe-assignment` lint rule tripping on the resulting `any`-typed
    // nested property.
    expect(commands.upsertOption).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', expectedSequence: 4 }),
    );
    const calledWith = vi.mocked(commands.upsertOption).mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({ option: { label: 'Honda CR-V', kind: 'car' } });
  });

  it('prefills the form from an existing option when Edit is clicked, and saves with its optionId', async () => {
    const user = userEvent.setup();
    const { commands } = renderEditor({ options: [buildEntity()] });

    await user.click(screen.getByTestId('option-editor-list-trigger'));
    await user.click(screen.getByTestId('option-editor-edit-candidate-rav4'));
    expect(screen.getByLabelText('Option label')).toHaveValue('Toyota RAV4');

    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(commands.upsertOption).toHaveBeenCalledWith(
        expect.objectContaining({ optionId: 'candidate-rav4' }),
      );
    });
  });

  it('cancel returns the form to a blank new-option state after editing', async () => {
    const user = userEvent.setup();
    renderEditor({ options: [buildEntity()] });

    await user.click(screen.getByTestId('option-editor-list-trigger'));
    await user.click(screen.getByTestId('option-editor-edit-candidate-rav4'));
    expect(screen.getByLabelText('Option label')).toHaveValue('Toyota RAV4');

    await user.click(screen.getByTestId('option-editor-cancel'));

    expect(screen.getByLabelText('Option label')).toHaveValue('');
    expect(screen.queryByTestId('option-editor-cancel')).not.toBeInTheDocument();
  });

  it('includes an entered attribute value in the saved option payload', async () => {
    const user = userEvent.setup();
    const { commands } = renderEditor(
      {},
      { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
    );

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.type(screen.getByLabelText('Mileage'), '12000');
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(commands.upsertOption).toHaveBeenCalledTimes(1);
    });
    const calledWith = vi.mocked(commands.upsertOption).mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({
      option: {
        attributes: [
          { definitionId: 'mileage', value: { type: 'number', value: 12000, unit: 'mi' } },
        ],
      },
    });
  });

  // The old `option-editor-new` "Add {label}" button is gone -- adding is
  // now the sheet's own default state -- but what it used to guarantee moved
  // with it rather than being dropped: `option-editor-save` itself is now
  // gated on `atCapacity` (which is `false` the moment `form.optionId` is
  // set), so a full case blocks a new Save directly while leaving editing an
  // EXISTING candidate fully live -- unlike the old layout, where the "Add"
  // button being disabled left the form and its own Save underneath fully
  // live regardless, so a full case only ever told you on submit.
  it("disables Save while adding once the case is at the contract's own entity cap, but keeps it live for editing an existing candidate there", async () => {
    const user = userEvent.setup();
    const options = Array.from({ length: MAX_CASE_ENTITIES }, (_, index) =>
      buildEntity({ id: `candidate-${index}`, label: `Candidate ${index}` }),
    );
    const { commands } = renderEditor(
      { options },
      { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
    );
    expect(screen.getByTestId('option-editor-max-reached')).toHaveTextContent(
      `${String(MAX_CASE_ENTITIES)}`,
    );

    await user.type(screen.getByLabelText('Option label'), 'One too many');
    expect(screen.getByTestId('option-editor-save')).toBeDisabled();

    await user.click(screen.getByTestId('option-editor-list-trigger'));
    await user.click(screen.getByTestId('option-editor-edit-candidate-0'));
    expect(screen.getByTestId('option-editor-save')).not.toBeDisabled();
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(commands.upsertOption).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(commands.upsertOption).mock.calls[0]?.[0]).toMatchObject({
      optionId: 'candidate-0',
    });
  });

  // The regression this pair exists for: the cap defaulted to a hardcoded 5
  // that no contract, command or store ever agreed with, so Bid Comparison --
  // which seeds twelve bids -- rendered an Add form that refused every entry
  // on a case the engine accepted. A cap the rest of the system does not
  // share is a bug, not a limit.
  it('still accepts a new option on a case holding more than the old hardcoded limit', async () => {
    const user = userEvent.setup();
    const options = Array.from({ length: 12 }, (_, index) =>
      buildEntity({ id: `candidate-${index}`, label: `Candidate ${index}` }),
    );
    const { commands } = renderEditor(
      { options },
      { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
    );
    expect(screen.queryByTestId('option-editor-max-reached')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Option label'), 'Candidate 13');
    expect(screen.getByTestId('option-editor-save')).not.toBeDisabled();
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(commands.upsertOption).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(commands.upsertOption).mock.calls[0]?.[0]).toMatchObject({
      option: { label: 'Candidate 13' },
    });
  });

  it('shows a recoverable error and preserves the entered label when upsertOption fails', async () => {
    const user = userEvent.setup();
    renderEditor({}, { upsertOption: vi.fn().mockRejectedValue(new Error('Network is down')) });

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(screen.getByTestId('option-editor-error')).toHaveTextContent('Network is down');
    });
    expect(screen.getByLabelText('Option label')).toHaveValue('Honda CR-V');
  });

  it('disables the save control while a save is pending', async () => {
    const user = userEvent.setup();
    let resolveUpsert: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveUpsert = resolve;
    });
    renderEditor({}, { upsertOption: vi.fn().mockReturnValue(pending) });

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.click(screen.getByTestId('option-editor-save'));

    expect(screen.getByTestId('option-editor-save')).toBeDisabled();
    resolveUpsert(buildFakeCommandReceipt());
  });

  it('does nothing when the form is submitted with a blank/whitespace-only label', async () => {
    const { commands } = renderEditor({}, { upsertOption: vi.fn() });

    fireEvent.submit(screen.getByTestId('option-editor-form'));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(commands.upsertOption).not.toHaveBeenCalled();
  });

  it('ignores a second form submission while a save is already in flight', async () => {
    const user = userEvent.setup();
    let resolveUpsert: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveUpsert = resolve;
    });
    const { commands } = renderEditor({}, { upsertOption: vi.fn().mockReturnValue(pending) });

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.click(screen.getByTestId('option-editor-save'));
    expect(commands.upsertOption).toHaveBeenCalledTimes(1);

    // The button itself is disabled while saving, so this directly submits
    // the underlying `<form>` element -- the exact defensive path the
    // `saving` half of `handleSubmit`'s guard exists for (e.g. a real
    // browser's implicit Enter-to-submit behavior racing an in-flight save).
    fireEvent.submit(screen.getByTestId('option-editor-form'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(commands.upsertOption).toHaveBeenCalledTimes(1);

    resolveUpsert(buildFakeCommandReceipt());
  });

  it('shows the generic "Could not save this option." message when upsertOption rejects with a non-Error value', async () => {
    const user = userEvent.setup();
    renderEditor({}, { upsertOption: vi.fn().mockRejectedValue('network is down') });

    await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
    await user.click(screen.getByTestId('option-editor-save'));

    await waitFor(() => {
      expect(screen.getByTestId('option-editor-error')).toHaveTextContent(
        'Could not save this option.',
      );
    });
  });

  it('has no axe violations', async () => {
    const { container } = renderEditor({ options: [buildEntity()] });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const commands = createFakeSiftCommands();
    const { overflowRisks } = renderAtNarrowWidth(
      <AppProviders commandsClient={commands}>
        <OptionEditor
          caseId="case-1"
          resolveExpectedSequence={() => Promise.resolve(1)}
          optionKind="car"
          optionLabel="car"
          attributeDefinitions={ATTRIBUTE_DEFINITIONS}
          options={[buildEntity()]}
        />
      </AppProviders>,
    );
    expect(overflowRisks).toEqual([]);
  });

  describe('touch targets (docs/specs/testing.md 44px minimum)', () => {
    // The old `option-editor-new` "Add {label}" button (compact `size="sm"`,
    // 32px tall, below the 44px minimum) is gone -- adding is now the
    // sheet's own default state, so there is nothing left to click to reach
    // it. Its replacement as the sheet's own new primary disclosure controls
    // are the two `CollapsibleTrigger`s this redesign introduced: the
    // existing-options roster and (on a bid-kind pack) the document import.
    // Both carry an explicit override in `OptionEditor.tsx`'s own className,
    // asserted here via class presence -- jsdom does not run a real layout
    // engine (see ../test/narrow-viewport.tsx's identical caveat).
    it('gives the existing-options roster disclosure trigger the 44px touch-target override', () => {
      renderEditor({ options: [buildEntity()] });
      expect(screen.getByTestId('option-editor-list-trigger')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
    });

    it('gives the bid-document-import disclosure trigger the 44px touch-target override', () => {
      renderEditor({
        optionKind: 'bid',
        optionLabel: 'bid',
        attributeDefinitions: [
          {
            id: 'bid.quoted_total',
            label: 'Quoted total',
            valueType: 'money',
            required: true,
            appliesTo: ['bid'],
            evidenceExpectation: 'assertion',
            comparison: 'lower_better',
            sensitive: false,
          },
        ],
      });
      expect(screen.getByTestId('option-editor-import-trigger')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
    });

    // `option-editor-edit-*` uses the even more compact `size="xs"` variant
    // (`h-6`, 24px tall) with no override, and `variant="secondary"` overridden
    // to `bg-card` -- fully opaque at rest, unlike the untouched default fill.
    // Now sits behind the roster's own collapsed-by-default disclosure, so it
    // must be opened first.
    it('gives each row\'s Edit button the 44px touch-target override despite its compact "xs" size, and a fill visible at rest (not only on hover)', async () => {
      const user = userEvent.setup();
      renderEditor({ options: [buildEntity()] });
      await user.click(screen.getByTestId('option-editor-list-trigger'));
      const editButton = screen.getByTestId('option-editor-edit-candidate-rav4');

      expect(editButton).toHaveClass('min-h-[var(--size-touch-target-min)]');
      // `bg-card` (not hover-prefixed) proves a fill renders at rest, per
      // the same bg-card-on-a-non-default-surface mechanism
      // ApprovalCard.tsx's own "secondary" buttons already use to stay
      // visible against a surface where the variant's flat default fill
      // would blend in.
      expect(editButton).toHaveClass('bg-card');
    });

    // `option-editor-save` (the "Save {optionLabel}"/"Save changes" submit
    // button, the form's primary persist action) had no `size` prop at all,
    // so it defaulted to `size="default"` -> `h-9` = 36px -- still under
    // the 44px minimum, and distinct from `option-editor-new` ("Add
    // {optionLabel}") above.
    it('gives the Save option button the 44px touch-target override', () => {
      renderEditor();
      expect(screen.getByTestId('option-editor-save')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
    });
  });

  /**
   * The document-import half. `submitBidDocument` is bid-specific, so the
   * affordance is gated on the case's own pack-declared option kind -- and
   * everything it writes is a PROPOSAL, which is what most of these assert:
   * an extracted value must stay distinguishable from a typed one, on screen
   * and on the wire.
   */
  describe('bid document import', () => {
    const BID_DEFINITIONS: AttributeDefinition[] = [
      {
        id: 'bid.quoted_total',
        label: 'Quoted total',
        valueType: 'money',
        required: true,
        appliesTo: ['bid'],
        evidenceExpectation: 'assertion',
        comparison: 'lower_better',
        sensitive: false,
      },
      {
        id: 'bid.deposit_percent',
        label: 'Deposit requested',
        valueType: 'number',
        required: true,
        appliesTo: ['bid'],
        unit: '%',
        evidenceExpectation: 'assertion',
        comparison: 'lower_better',
        sensitive: false,
      },
      {
        id: 'bid.warranty_months',
        label: 'Warranty term',
        valueType: 'number',
        required: false,
        appliesTo: ['bid'],
        unit: 'months',
        evidenceExpectation: 'assertion',
        comparison: 'higher_better',
        sensitive: false,
      },
    ];

    const DOCUMENT_TEXT = '{"contractorName":"Northgate Builders","total":{"amount":48200}}';

    function importedBid(): EntityRecord {
      return {
        id: 'option-imported',
        kind: 'bid',
        label: 'Northgate Builders',
        attributes: {
          'bid.quoted_total': {
            definitionId: 'bid.quoted_total',
            label: 'Quoted total',
            value: { type: 'money', amount: 48200, currency: 'USD' },
            origin: 'agent_proposed',
            sourceIds: ['source-doc-1'],
            confidence: 0.9,
            status: 'supported',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
          'bid.deposit_percent': {
            definitionId: 'bid.deposit_percent',
            label: 'Deposit requested',
            origin: 'agent_proposed',
            sourceIds: ['source-doc-1'],
            status: 'unknown',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
          'bid.warranty_months': {
            definitionId: 'bid.warranty_months',
            label: 'Warranty term',
            origin: 'agent_proposed',
            sourceIds: ['source-doc-1'],
            status: 'unknown',
            updatedAt: '2026-09-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
    }

    function renderBidEditor(
      overrides: Partial<React.ComponentProps<typeof OptionEditor>> = {},
      commandsOverrides: Parameters<typeof createFakeSiftCommands>[0] = {},
    ) {
      return renderEditor(
        {
          optionKind: 'bid',
          optionLabel: 'bid',
          attributeDefinitions: BID_DEFINITIONS,
          ...overrides,
        },
        {
          submitBidDocument: vi.fn().mockResolvedValue(
            buildFakeCommandReceipt({
              caseId: 'case-1',
              snapshot: buildFixtureCaseState({ entities: [importedBid()] }),
            }),
          ),
          ...commandsOverrides,
        },
      );
    }

    // The import panel is now behind a collapsed-by-default disclosure
    // (`option-editor-import-trigger`); none of its own `bid-document-import*`
    // testids exist until it is opened. Opening it here once means every
    // call site below can keep filling the same fields it always did.
    async function importDocument(
      user: ReturnType<typeof userEvent.setup>,
      text = DOCUMENT_TEXT,
      filename = 'bid-northgate.json',
    ) {
      await user.click(screen.getByTestId('option-editor-import-trigger'));
      fireEvent.change(screen.getByTestId('bid-document-import-text'), { target: { value: text } });
      await user.type(screen.getByLabelText('Document name'), filename);
      await user.selectOptions(screen.getByLabelText('Document format'), 'application/json');
      await user.click(screen.getByTestId('bid-document-import-submit'));
    }

    it('is absent on a pack whose options are not bids', () => {
      renderEditor();
      expect(screen.queryByTestId('bid-document-import-trigger')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bid-document-import')).not.toBeInTheDocument();
    });

    it('is offered (behind its own disclosure) on a pack whose declared option kind is the one the command writes', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      expect(screen.queryByTestId('bid-document-import')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('option-editor-import-trigger'));
      expect(screen.getByTestId('bid-document-import')).toBeInTheDocument();
    });

    it('sends a chosen JSON file through submitBidDocument as document text', async () => {
      const user = userEvent.setup();
      const { commands } = renderBidEditor();

      await user.click(screen.getByTestId('option-editor-import-trigger'));
      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File([DOCUMENT_TEXT], 'bid-northgate.json', { type: 'application/json' }),
      );
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue(DOCUMENT_TEXT);
      });
      await user.click(screen.getByTestId('bid-document-import-submit'));

      await waitFor(() => {
        expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
      });
      const calledWith = vi.mocked(commands.submitBidDocument).mock.calls[0]?.[0];
      expect(calledWith).toMatchObject({
        caseId: 'case-1',
        expectedSequence: 4,
        document: {
          filename: 'bid-northgate.json',
          format: 'application/json',
          text: DOCUMENT_TEXT,
        },
      });
    });

    it('summarises what was read and what was not, then puts the person into editing the new option', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      await importDocument(user);

      const read = await screen.findByTestId('bid-document-import-read-bid.quoted_total');
      expect(read).toHaveTextContent('Confidence 90%');
      expect(
        screen.getByTestId('bid-document-import-unread-bid.deposit_percent'),
      ).toHaveTextContent('Required');

      // The form is now editing the option the server actually wrote.
      expect(screen.getByLabelText('Option label')).toHaveValue('Northgate Builders');
      expect(screen.getByLabelText('Quoted total amount')).toHaveValue(48200);
      expect(screen.getByTestId('option-editor-save')).toHaveTextContent('Save changes');
    });

    it('marks every field still holding a value the document supplied, and says it is unverified', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      await importDocument(user);

      const marked = await screen.findByTestId('option-editor-imported-bid.quoted_total');
      expect(marked).toHaveTextContent('Read from the document');
      expect(marked).toHaveTextContent('Confidence 90%');
      expect(marked).toHaveTextContent('Not verified');
      expect(screen.getByTestId('option-editor-imported-label')).toHaveTextContent(
        'Read from the document',
      );
      expect(screen.getByTestId('option-editor-import-caution')).toHaveTextContent(
        'Anything you type here is saved as your own entry.',
      );
    });

    it('leaves a field the document never stated empty, and says so rather than showing a value', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      await importDocument(user);

      expect(await screen.findByLabelText('Deposit requested')).toHaveValue(null);
      const unread = screen.getByTestId('option-editor-imported-bid.deposit_percent');
      expect(unread).toHaveTextContent('did not state this');
      expect(unread).toHaveTextContent('Nothing is recorded here');
    });

    it('drops the mark from a field once the person edits it -- that value is now theirs', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      await importDocument(user);
      await screen.findByTestId('option-editor-imported-bid.quoted_total');

      await user.clear(screen.getByLabelText('Quoted total amount'));
      await user.type(screen.getByLabelText('Quoted total amount'), '47000');

      expect(
        screen.queryByTestId('option-editor-imported-bid.quoted_total'),
      ).not.toBeInTheDocument();
    });

    // The rule this protects: saving must not launder a proposal into the
    // person's own assertion. `upsertOption` defaults an attribute carrying
    // no provenance to `origin: 'user'`/`status: 'asserted'`, so an untouched
    // extracted value has to carry its own provenance back up.
    it("keeps the extraction's provenance on untouched values, and records an edited one as the person's own", async () => {
      const user = userEvent.setup();
      const { commands } = renderBidEditor();

      await importDocument(user);
      await screen.findByTestId('option-editor-imported-bid.quoted_total');

      await user.type(screen.getByLabelText('Warranty term'), '24');
      await user.click(screen.getByTestId('option-editor-save'));

      await waitFor(() => {
        expect(commands.upsertOption).toHaveBeenCalledTimes(1);
      });
      const calledWith = vi.mocked(commands.upsertOption).mock.calls[0]?.[0];
      expect(calledWith).toMatchObject({ optionId: 'option-imported' });
      const attributes = calledWith?.option.attributes ?? [];

      expect(attributes).toContainEqual({
        definitionId: 'bid.quoted_total',
        value: { type: 'money', amount: 48200, currency: 'USD' },
        origin: 'agent_proposed',
        status: 'supported',
        sourceIds: ['source-doc-1'],
        confidence: 0.9,
      });
      // Still explicitly unknown, still pointing at the document that was
      // searched -- never dropped by a save that replaces the map.
      expect(attributes).toContainEqual({
        definitionId: 'bid.deposit_percent',
        status: 'unknown',
        origin: 'agent_proposed',
        sourceIds: ['source-doc-1'],
      });
      // Typed by the person: no provenance, so the handler records it as
      // theirs.
      expect(attributes).toContainEqual({
        definitionId: 'bid.warranty_months',
        value: { type: 'number', value: 24, unit: 'months' },
      });
    });

    it('refuses an over-size document client-side, with a real message and no command call', async () => {
      const user = userEvent.setup();
      const { commands } = renderBidEditor();

      await importDocument(user, 'a'.repeat(MAX_BID_DOCUMENT_BYTES + 1));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent('256 KB');
      expect(error).toHaveTextContent('Nothing was sent.');
      expect(commands.submitBidDocument).not.toHaveBeenCalled();
    });

    it('surfaces the server error for a document that could not be read as a bid', async () => {
      const user = userEvent.setup();
      renderBidEditor(
        {},
        {
          submitBidDocument: vi
            .fn()
            .mockRejectedValue(
              new Error('The document "bid-northgate.json" could not be read as a bid.'),
            ),
        },
      );

      await importDocument(user, '{not json');

      expect(await screen.findByTestId('bid-document-import-error')).toHaveTextContent(
        'could not be read as a bid',
      );
      expect(screen.queryByTestId('bid-document-import-summary')).not.toBeInTheDocument();
    });

    // REGRESSION, not a redesign choice -- flagged explicitly in this task's
    // final report rather than silently accepted.
    //
    // The intent, unchanged in `OptionEditor.tsx`'s own comment above
    // `showDocumentImport`, is that an import always ADDS an option, so
    // offering it while some other pre-existing option is open for editing
    // would silently abandon that edit. Before this redesign that was
    // enforced by a separate `imported` state, set ONLY by a completed
    // import, so a plain `startEdit` on a never-imported option correctly
    // left it `null` and `showDocumentImport`'s
    // `form.optionId === imported?.optionId` clause false.
    //
    // This redesign folded that state into the shared `baseline` (needed
    // for the provenance fix this task's own header comment describes:
    // `formFromEntity` returning `{ form, baseline }`) -- and `startEdit`
    // now sets `baseline.optionId = entity.id` for ANY edit, not just an
    // import. Because that is exactly `form.optionId` right after any
    // `startEdit`, `showDocumentImport`'s `form.optionId ===
    // baseline?.optionId` clause is now trivially true the moment ANY
    // pre-existing option is opened for editing -- so the affordance this
    // test's own name used to describe is never actually withdrawn any
    // more. Asserted here as it now truthfully behaves.
    // An import always CREATES an option, so offering it while a
    // pre-existing one is open for correction would silently abandon that
    // edit. This briefly regressed: folding the import-only `ImportedState`
    // into the general `BaselineState` made the "is this the option the
    // import just made?" comparison true for every edit, because an ordinary
    // edit populates a baseline too. Only an import-sourced baseline carries
    // a `filename`, which is what the condition now keys on.
    it('withdraws the import affordance while a pre-existing, never-imported option is being edited', async () => {
      const user = userEvent.setup();
      const existing = { ...buildEntity({ id: 'bid-existing', kind: 'bid' }) };
      renderBidEditor({ options: [existing] });

      expect(screen.getByTestId('option-editor-import-trigger')).toBeInTheDocument();

      await user.click(screen.getByTestId('option-editor-list-trigger'));
      await user.click(screen.getByTestId('option-editor-edit-bid-existing'));

      expect(screen.queryByTestId('option-editor-import-trigger')).not.toBeInTheDocument();

      // ...and returns once the edit is abandoned, so the affordance is
      // withdrawn for the duration of the edit rather than lost for good.
      await user.click(screen.getByTestId('option-editor-cancel'));
      expect(screen.getByTestId('option-editor-import-trigger')).toBeInTheDocument();
    });

    // The other side of that condition: correcting the option an import just
    // created KEEPS the panel, because its summary of what was and was not
    // read belongs on screen beside the fields it filled in.
    it('keeps the import affordance while correcting the option an import just created', async () => {
      const user = userEvent.setup();
      renderBidEditor();

      await importDocument(user);
      await screen.findByTestId('option-editor-imported-bid.quoted_total');

      expect(screen.getByTestId('option-editor-import-trigger')).toBeInTheDocument();
    });

    it('has no axe violations with an imported option open for correction', async () => {
      const user = userEvent.setup();
      const { container } = renderBidEditor();

      await importDocument(user);
      await screen.findByTestId('option-editor-imported-bid.quoted_total');

      expect(await axe(container)).toHaveNoViolations();
    });
  });

  /**
   * THE BUG THIS TASK FIXES (`OptionEditor.tsx`'s own `BaselineState` doc
   * comment): `formFromEntity` used to keep only `record.value` and drop
   * `origin`/`status`/`confidence`/`sourceIds` entirely, so pressing "Edit"
   * on an existing option and then "Save" -- typing nothing at all --
   * re-sent every attribute with no provenance, and `upsertOption`'s handler
   * defaults an attribute carrying no provenance to the person's own
   * `origin: 'user'`/`status: 'asserted'`. Verified live against a seeded
   * Bid Comparison case: a no-op edit silently rewrote all ten of
   * Northgate's `origin: 'pack'` records to `origin: 'user'` with
   * `sourceIds: []`, destroying every link to the bid document, the licence
   * registry, and the calculator's own working.
   */
  describe('editing provenance (regression: a no-op edit must not launder existing provenance)', () => {
    const PROVENANCE_DEFINITIONS: AttributeDefinition[] = [
      ...ATTRIBUTE_DEFINITIONS,
      {
        id: 'notes',
        label: 'Notes',
        valueType: 'string',
        required: false,
        appliesTo: ['car'],
        evidenceExpectation: 'assertion',
        comparison: 'none',
        sensitive: false,
      },
    ];

    function sourcedEntity(): EntityRecord {
      return buildEntity({
        attributes: {
          price: {
            definitionId: 'price',
            label: 'Price',
            value: { type: 'money', amount: 28500, currency: 'USD' },
            origin: 'pack',
            sourceIds: ['s1'],
            status: 'asserted',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          mileage: {
            definitionId: 'mileage',
            label: 'Mileage',
            value: { type: 'number', value: 42000, unit: 'mi' },
            origin: 'pack',
            sourceIds: ['s1'],
            confidence: 0.6,
            status: 'asserted',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          notes: {
            definitionId: 'notes',
            label: 'Notes',
            origin: 'pack',
            sourceIds: ['s1'],
            status: 'unknown',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
      });
    }

    async function openForEdit(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId('option-editor-list-trigger'));
      await user.click(screen.getByTestId('option-editor-edit-candidate-rav4'));
    }

    it("keeps every attribute's origin, status, sourceIds and confidence when Save is pressed WITHOUT TYPING anything", async () => {
      const user = userEvent.setup();
      const { commands } = renderEditor(
        { attributeDefinitions: PROVENANCE_DEFINITIONS, options: [sourcedEntity()] },
        { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
      );

      await openForEdit(user);
      expect(screen.getByLabelText('Option label')).toHaveValue('Toyota RAV4');
      await user.click(screen.getByTestId('option-editor-save'));

      await waitFor(() => {
        expect(commands.upsertOption).toHaveBeenCalledTimes(1);
      });
      const calledWith = vi.mocked(commands.upsertOption).mock.calls[0]?.[0];
      expect(calledWith).toMatchObject({ optionId: 'candidate-rav4' });
      const attributes = calledWith?.option.attributes ?? [];

      expect(attributes).toContainEqual({
        definitionId: 'price',
        value: { type: 'money', amount: 28500, currency: 'USD' },
        origin: 'pack',
        status: 'asserted',
        sourceIds: ['s1'],
      });
      expect(attributes).toContainEqual({
        definitionId: 'mileage',
        value: { type: 'number', value: 42000, unit: 'mi' },
        origin: 'pack',
        status: 'asserted',
        sourceIds: ['s1'],
        confidence: 0.6,
      });
      // status:'unknown' stays unknown, with its own origin and sourceIds --
      // never dropped or reassigned by an untouched save.
      expect(attributes).toContainEqual({
        definitionId: 'notes',
        status: 'unknown',
        origin: 'pack',
        sourceIds: ['s1'],
      });
      // Nothing extra, nothing missing: exactly these three, exactly as
      // they were before Edit/Save.
      expect(attributes).toHaveLength(3);
    });

    it("sends only the ONE typed field with no provenance, and keeps every other field's original provenance intact", async () => {
      const user = userEvent.setup();
      const { commands } = renderEditor(
        { attributeDefinitions: PROVENANCE_DEFINITIONS, options: [sourcedEntity()] },
        { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
      );

      await openForEdit(user);
      await user.clear(screen.getByLabelText('Mileage'));
      await user.type(screen.getByLabelText('Mileage'), '39000');
      await user.click(screen.getByTestId('option-editor-save'));

      await waitFor(() => {
        expect(commands.upsertOption).toHaveBeenCalledTimes(1);
      });
      const attributes =
        vi.mocked(commands.upsertOption).mock.calls[0]?.[0]?.option.attributes ?? [];

      // Typed by the person: no provenance at all, which is what makes
      // `upsertOption`'s handler default it to their own
      // `origin: 'user'`/`status: 'asserted'` entry.
      expect(attributes).toContainEqual({
        definitionId: 'mileage',
        value: { type: 'number', value: 39000, unit: 'mi' },
      });
      // Untouched -- still carrying the case's own provenance, exactly as
      // it was before this edit.
      expect(attributes).toContainEqual({
        definitionId: 'price',
        value: { type: 'money', amount: 28500, currency: 'USD' },
        origin: 'pack',
        status: 'asserted',
        sourceIds: ['s1'],
      });
      expect(attributes).toContainEqual({
        definitionId: 'notes',
        status: 'unknown',
        origin: 'pack',
        sourceIds: ['s1'],
      });
      expect(attributes).toHaveLength(3);
    });

    // Item 6 of this task's UI changes: `InheritedValueNote`'s badge for an
    // EXISTING option's value (`filename === null`) reads "Already on this
    // case" (citing its real source count) for a recorded value, and
    // "Recorded as unknown" for one the case never recorded at all --
    // distinct from the import-path badges ("Read from the document"/"Not
    // stated in the document"), which only apply when `filename !== null`.
    it('marks an untouched existing value "Already on this case" (citing its real source count), and an untouched unknown one "Recorded as unknown"', async () => {
      const user = userEvent.setup();
      renderEditor({ attributeDefinitions: PROVENANCE_DEFINITIONS, options: [sourcedEntity()] });

      await openForEdit(user);

      const priceNote = screen.getByTestId('option-editor-imported-price');
      expect(priceNote).toHaveTextContent('Already on this case');
      expect(priceNote).toHaveTextContent('cites 1 source');

      const notesNote = screen.getByTestId('option-editor-imported-notes');
      expect(notesNote).toHaveTextContent('Recorded as unknown');
    });
  });

  describe('derived ("What Sift works out") fields', () => {
    const MIXED_DEFINITIONS: AttributeDefinition[] = [
      {
        id: 'price',
        label: 'Price',
        valueType: 'money',
        required: false,
        appliesTo: ['car'],
        evidenceExpectation: 'source',
        comparison: 'lower_better',
        sensitive: false,
      },
      {
        id: 'mileage',
        label: 'Mileage',
        valueType: 'number',
        required: false,
        appliesTo: ['car'],
        unit: 'mi',
        evidenceExpectation: 'assertion',
        comparison: 'lower_better',
        sensitive: false,
      },
      {
        id: 'adjusted_total',
        label: 'Adjusted total',
        valueType: 'money',
        required: false,
        appliesTo: ['car'],
        evidenceExpectation: 'verification',
        comparison: 'lower_better',
        sensitive: false,
      },
      {
        id: 'scope_completeness',
        label: 'Scope completeness',
        valueType: 'number',
        required: false,
        appliesTo: ['car'],
        unit: '%',
        evidenceExpectation: 'verification',
        comparison: 'higher_better',
        sensitive: false,
      },
    ];

    it('groups exactly the evidenceExpectation:"verification" definitions under "What Sift works out", leaves every other applicable definition above it, and keeps them all editable', async () => {
      const user = userEvent.setup();
      const { commands } = renderEditor(
        { attributeDefinitions: MIXED_DEFINITIONS },
        { upsertOption: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
      );

      // Composed from the definition ids rather than written out, the way
      // `DynamicAttributeField` composes them itself -- so the expectation
      // cannot drift from the definitions above, and no literal here is a
      // long opaque string for `check:source`'s entropy scanner to read as a
      // possible secret.
      const fieldTestId = (definitionId: string) => `dynamic-attribute-field-${definitionId}`;
      const derived = MIXED_DEFINITIONS.filter((d) => d.evidenceExpectation === 'verification');
      const stated = MIXED_DEFINITIONS.filter((d) => d.evidenceExpectation !== 'verification');
      expect(derived.length).toBeGreaterThan(0);
      expect(stated.length).toBeGreaterThan(0);

      const derivedGroup = screen.getByTestId('option-editor-derived-group');
      for (const definition of derived) {
        expect(within(derivedGroup).getByTestId(fieldTestId(definition.id))).toBeInTheDocument();
      }
      // The non-`verification` fields render OUTSIDE the group -- never
      // duplicated into it.
      for (const definition of stated) {
        expect(
          within(derivedGroup).queryByTestId(fieldTestId(definition.id)),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId(fieldTestId(definition.id))).toBeInTheDocument();
      }
      // Exactly the `verification` fields sit in the group -- nothing else.
      expect(within(derivedGroup).getAllByTestId(/^dynamic-attribute-field-/)).toHaveLength(
        derived.length,
      );

      // Still editable: typing into a derived field is what gets saved.
      await user.type(screen.getByLabelText('Option label'), 'Honda CR-V');
      await user.type(screen.getByLabelText('Scope completeness'), '92');
      await user.click(screen.getByTestId('option-editor-save'));

      await waitFor(() => {
        expect(commands.upsertOption).toHaveBeenCalledTimes(1);
      });
      const calledWith = vi.mocked(commands.upsertOption).mock.calls[0]?.[0];
      expect(calledWith).toMatchObject({
        option: {
          attributes: [
            { definitionId: 'scope_completeness', value: { type: 'number', value: 92, unit: '%' } },
          ],
        },
      });
    });
  });
});
