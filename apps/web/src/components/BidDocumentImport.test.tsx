import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import type { AttributeDefinition, AttributeRecord, EntityRecord } from '@sift/contracts';
import { BidDocumentImport } from './BidDocumentImport.js';
import { SiftClientError } from '../api/sift-client.js';
import { AppProviders } from '../app/AppProviders.js';
import { buildFakeCommandReceipt, createFakeSiftCommands } from '../test/fake-sift-commands.js';
import { buildFixtureCaseState } from '../test/fixtures.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';

const TIMESTAMP = '2026-09-01T00:00:00.000Z';

const ATTRIBUTE_DEFINITIONS: AttributeDefinition[] = [
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

function importedEntity(): EntityRecord {
  const records: AttributeRecord[] = [
    {
      definitionId: 'bid.quoted_total',
      label: 'Quoted total',
      value: { type: 'money', amount: 48200, currency: 'USD' },
      origin: 'agent_proposed',
      sourceIds: ['source-doc-1'],
      confidence: 0.9,
      status: 'supported',
      updatedAt: TIMESTAMP,
    },
    {
      definitionId: 'bid.deposit_percent',
      label: 'Deposit requested',
      origin: 'agent_proposed',
      sourceIds: ['source-doc-1'],
      status: 'unknown',
      updatedAt: TIMESTAMP,
    },
    {
      definitionId: 'bid.warranty_months',
      label: 'Warranty term',
      origin: 'agent_proposed',
      sourceIds: ['source-doc-1'],
      status: 'unknown',
      updatedAt: TIMESTAMP,
    },
  ];
  return {
    id: 'option-imported',
    kind: 'bid',
    label: 'Northgate Builders',
    attributes: Object.fromEntries(records.map((record) => [record.definitionId, record])),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function receiptWithImportedOption() {
  return buildFakeCommandReceipt({
    caseId: 'case-1',
    snapshot: buildFixtureCaseState({ entities: [importedEntity()] }),
  });
}

function renderImport(
  overrides: Partial<React.ComponentProps<typeof BidDocumentImport>> = {},
  commandsOverrides: Parameters<typeof createFakeSiftCommands>[0] = {},
) {
  const onImported = vi.fn();
  const commands = createFakeSiftCommands(commandsOverrides);
  const utils = render(
    <AppProviders commandsClient={commands}>
      <BidDocumentImport
        caseId="case-1"
        resolveExpectedSequence={() => Promise.resolve(4)}
        optionLabel="bid"
        attributeDefinitions={ATTRIBUTE_DEFINITIONS}
        knownOptionIds={[]}
        caseIsFull={false}
        maxOptions={12}
        onImported={onImported}
        {...overrides}
      />
    </AppProviders>,
  );
  return { ...utils, commands, onImported };
}

/** Fills the paste path: text, name, and an explicitly chosen format. */
async function pasteDocument(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  filename = 'bid-northgate.json',
  format = 'application/json',
) {
  fireEvent.change(screen.getByTestId('bid-document-import-text'), { target: { value: text } });
  await user.type(screen.getByLabelText('Document name'), filename);
  await user.selectOptions(screen.getByLabelText('Document format'), format);
}

describe('BidDocumentImport', () => {
  it('offers a real file input that accepts the two formats the extractor reads', () => {
    renderImport();
    const input = screen.getByTestId('bid-document-import-file');
    expect(input).toHaveAttribute('type', 'file');
    expect(input.getAttribute('accept')).toContain('.json');
    expect(input.getAttribute('accept')).toContain('.csv');
  });

  it('reads a chosen file with FileReader, derives its format, and sends it as document text', async () => {
    const user = userEvent.setup();
    const { commands } = renderImport(
      {},
      { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
    );

    await user.upload(
      screen.getByTestId('bid-document-import-file'),
      new File([DOCUMENT_TEXT], 'bid-northgate.json', { type: 'application/json' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('bid-document-import-text')).toHaveValue(DOCUMENT_TEXT);
    });
    expect(screen.getByLabelText('Document name')).toHaveValue('bid-northgate.json');
    expect(screen.getByLabelText('Document format')).toHaveValue('application/json');
    expect(screen.getByTestId('bid-document-import-format-derived')).toHaveTextContent(
      'bid-northgate.json',
    );

    await user.click(screen.getByTestId('bid-document-import-submit'));

    await waitFor(() => {
      expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
    });
    expect(commands.submitBidDocument).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', expectedSequence: 4 }),
    );
    const calledWith = vi.mocked(commands.submitBidDocument).mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({
      document: {
        filename: 'bid-northgate.json',
        format: 'application/json',
        text: DOCUMENT_TEXT,
      },
    });
    // Never sent from this affordance: an import always ADDS an option, so
    // it can never silently merge onto one already on the case.
    expect(calledWith?.optionId).toBeUndefined();
  });

  it('derives text/csv from a .csv file', async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(
      screen.getByTestId('bid-document-import-file'),
      new File(['scope,amount\nroof,1200\n'], 'line-items.csv', { type: 'text/csv' }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Document format')).toHaveValue('text/csv');
    });
  });

  // Never guess silently: a CSV read as JSON imports nothing at all, without
  // failing, so the person is asked instead.
  it('refuses to guess a format it cannot derive, and blocks the submit until one is chosen', async () => {
    const user = userEvent.setup();
    const { commands } = renderImport();

    // `fireEvent`, not `user.upload`: user-event filters a chosen file
    // against the input's own `accept` list, and a file with neither a known
    // extension nor a known MIME type -- precisely the case under test -- can
    // never get past it.
    fireEvent.change(screen.getByTestId('bid-document-import-file'), {
      target: { files: [new File([DOCUMENT_TEXT], 'bid-export', { type: '' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('bid-document-import-text')).toHaveValue(DOCUMENT_TEXT);
    });
    expect(screen.getByLabelText('Document format')).toHaveValue('');
    expect(screen.getByTestId('bid-document-import-format-unknown')).toHaveTextContent(
      'Sift cannot tell what format "bid-export" is.',
    );
    expect(screen.getByTestId('bid-document-import-submit')).toBeDisabled();
    expect(commands.submitBidDocument).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Document format'), 'application/json');
    expect(screen.getByTestId('bid-document-import-submit')).not.toBeDisabled();
  });

  it('imports a pasted document with the format the person chose', async () => {
    const user = userEvent.setup();
    const { commands } = renderImport(
      {},
      { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
    );

    await pasteDocument(user, 'scope,amount\nroof,1200\n', 'pasted-bid.csv', 'text/csv');
    await user.click(screen.getByTestId('bid-document-import-submit'));

    await waitFor(() => {
      expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
    });
    const calledWith = vi.mocked(commands.submitBidDocument).mock.calls[0]?.[0];
    expect(calledWith).toMatchObject({
      document: { filename: 'pasted-bid.csv', format: 'text/csv' },
    });
  });

  it('lets the person correct a format derived from the file name', async () => {
    const user = userEvent.setup();
    const { commands } = renderImport(
      {},
      { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
    );

    await user.upload(
      screen.getByTestId('bid-document-import-file'),
      new File(['scope,amount\nroof,1200\n'], 'bid.json', { type: 'application/json' }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Document format')).toHaveValue('application/json');
    });

    await user.selectOptions(screen.getByLabelText('Document format'), 'text/csv');
    expect(screen.queryByTestId('bid-document-import-format-derived')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('bid-document-import-submit'));
    await waitFor(() => {
      expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(commands.submitBidDocument).mock.calls[0]?.[0]).toMatchObject({
      document: { format: 'text/csv' },
    });
  });

  describe('the summary of what was read', () => {
    it("names every field it read, with that field's own confidence", async () => {
      const user = userEvent.setup();
      renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await pasteDocument(user, DOCUMENT_TEXT);
      await user.click(screen.getByTestId('bid-document-import-submit'));

      const read = await screen.findByTestId('bid-document-import-read-bid.quoted_total');
      expect(read).toHaveTextContent('Quoted total');
      expect(read).toHaveTextContent('48,200');
      expect(read).toHaveTextContent('Confidence 90%');
      expect(read).toHaveTextContent('Read from the document');
      expect(read).toHaveTextContent('Not verified');
    });

    it('names the fields it could NOT read, flagging the required ones, with no value standing in for them', async () => {
      const user = userEvent.setup();
      renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await pasteDocument(user, DOCUMENT_TEXT);
      await user.click(screen.getByTestId('bid-document-import-submit'));

      const missingRequired = await screen.findByTestId(
        'bid-document-import-unread-bid.deposit_percent',
      );
      expect(missingRequired).toHaveTextContent('Deposit requested');
      expect(missingRequired).toHaveTextContent('Required');
      expect(missingRequired).toHaveTextContent('Not stated in this document.');
      // Nothing was recorded, so nothing may look like a value: no zero, no
      // placeholder, no lone dash.
      expect(missingRequired.textContent).not.toMatch(/\b0\b/);

      const missingOptional = screen.getByTestId('bid-document-import-unread-bid.warranty_months');
      expect(missingOptional).toHaveTextContent('Warranty term');
      expect(missingOptional).not.toHaveTextContent('Required');
    });

    it('hands the created option to its caller so the person can correct it', async () => {
      const user = userEvent.setup();
      const { onImported } = renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await pasteDocument(user, DOCUMENT_TEXT);
      await user.click(screen.getByTestId('bid-document-import-submit'));

      await waitFor(() => {
        expect(onImported).toHaveBeenCalledTimes(1);
      });
      expect(onImported.mock.calls[0]?.[0]).toMatchObject({
        filename: 'bid-northgate.json',
        option: { id: 'option-imported' },
      });
    });

    // A write that landed but whose receipt carried nothing to read back is
    // reported as exactly that -- never described from the request we sent.
    it('says plainly when it cannot read back what was recorded', async () => {
      const user = userEvent.setup();
      const { onImported } = renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(buildFakeCommandReceipt()) },
      );

      await pasteDocument(user, DOCUMENT_TEXT);
      await user.click(screen.getByTestId('bid-document-import-submit'));

      expect(await screen.findByTestId('bid-document-import-no-detail')).toHaveTextContent(
        'could not read back what was recorded',
      );
      expect(onImported).not.toHaveBeenCalled();
      expect(screen.queryByTestId('bid-document-import-summary')).not.toBeInTheDocument();
    });
  });

  describe('refusals and errors', () => {
    it('refuses an over-size document before sending it, naming both real sizes', async () => {
      const user = userEvent.setup();
      const { commands } = renderImport();

      await pasteDocument(user, 'a'.repeat(MAX_BID_DOCUMENT_BYTES + 1));
      await user.click(screen.getByTestId('bid-document-import-submit'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent('256 KB');
      expect(error).toHaveTextContent('Nothing was sent.');
      expect(commands.submitBidDocument).not.toHaveBeenCalled();
    });

    it("surfaces the server's own reason for a document it could not read as a bid", async () => {
      const user = userEvent.setup();
      renderImport(
        {},
        {
          submitBidDocument: vi.fn().mockRejectedValue(
            new SiftClientError('The document "bid-northgate.json" could not be read as a bid.', {
              status: 400,
              code: 'VALIDATION',
              retryable: false,
              details: ['Document is not valid JSON.'],
            }),
          ),
        },
      );

      await pasteDocument(user, '{not json');
      await user.click(screen.getByTestId('bid-document-import-submit'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent('could not be read as a bid');
      expect(screen.getByTestId('bid-document-import-error-details')).toHaveTextContent(
        'Document is not valid JSON.',
      );
    });

    it('falls back to a plain sentence when the failure is not an Error at all', async () => {
      const user = userEvent.setup();
      renderImport({}, { submitBidDocument: vi.fn().mockRejectedValue('nope') });

      await pasteDocument(user, DOCUMENT_TEXT);
      await user.click(screen.getByTestId('bid-document-import-submit'));

      expect(await screen.findByTestId('bid-document-import-error')).toHaveTextContent(
        'That document could not be imported.',
      );
    });

    it('will not import onto a case already holding its maximum options, and says why', async () => {
      const user = userEvent.setup();
      const { commands } = renderImport({ caseIsFull: true, maxOptions: 12 });

      await pasteDocument(user, DOCUMENT_TEXT);

      expect(screen.getByTestId('bid-document-import-full')).toHaveTextContent('maximum of 12');
      expect(screen.getByTestId('bid-document-import-submit')).toBeDisabled();
      expect(commands.submitBidDocument).not.toHaveBeenCalled();
    });
  });

  it("shows the live UTF-8 byte count against the contract's own cap", async () => {
    const user = userEvent.setup();
    renderImport();

    // Two bytes, one UTF-16 code unit: the counter must report what the
    // server measures.
    await user.type(screen.getByTestId('bid-document-import-text'), 'é');

    expect(screen.getByTestId('bid-document-import-size')).toHaveTextContent(
      `2 of ${MAX_BID_DOCUMENT_BYTES} bytes`,
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderImport();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const commands = createFakeSiftCommands();
    const { overflowRisks } = renderAtNarrowWidth(
      <AppProviders commandsClient={commands}>
        <BidDocumentImport
          caseId="case-1"
          resolveExpectedSequence={() => Promise.resolve(1)}
          optionLabel="bid"
          attributeDefinitions={ATTRIBUTE_DEFINITIONS}
          knownOptionIds={[]}
          caseIsFull={false}
          maxOptions={12}
          onImported={vi.fn()}
        />
      </AppProviders>,
    );
    expect(overflowRisks).toEqual([]);
  });
});
