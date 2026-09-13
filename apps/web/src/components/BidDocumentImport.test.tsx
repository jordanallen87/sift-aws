import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import type { AttributeDefinition, AttributeRecord, EntityRecord } from '@sift/contracts';

// `pdf-bid-document.ts` runs real `pdfjs-dist` parsing against a Web Worker
// -- neither belongs in this component's own tests (this repo's "no
// network, no real files over the wire" rule; `pdf-bid-document.test.ts`
// already covers the real extraction logic against a `pdfjs-dist` double of
// its own). This component only needs to react to whatever
// `extractPdfDocumentText` resolves to, so the whole module is replaced
// with a controllable stub. `vi.hoisted` for the same reason
// `pdf-bid-document.test.ts` uses it: `vi.mock` is hoisted above every
// import in this file, so a plain `const` declared after it would be read
// before it is initialized.
const { extractPdfDocumentText } = vi.hoisted(() => ({ extractPdfDocumentText: vi.fn() }));
vi.mock('./pdf-bid-document.js', () => ({ extractPdfDocumentText }));

import { BidDocumentImport } from './BidDocumentImport.js';
import { SiftClientError } from '../api/sift-client.js';
import { AppProviders } from '../app/AppProviders.js';
import { buildFakeCommandReceipt, createFakeSiftCommands } from '../test/fake-sift-commands.js';
import { buildFixtureCaseState } from '../test/fixtures.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';
import type { PdfTextExtractionResult } from './pdf-bid-document.js';

const TIMESTAMP = '2026-09-01T00:00:00.000Z';

/** A promise this test controls the settlement of, for asserting an intermediate pending state before resolving/rejecting it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  beforeEach(() => {
    // `extractPdfDocumentText` is one shared `vi.fn()` for the whole file
    // (`vi.hoisted`, above) -- reset between tests so a `mockResolvedValue`
    // or call count from an earlier PDF test never leaks into the next one.
    extractPdfDocumentText.mockReset();
  });

  it('offers a real file input that accepts the two extractor formats and PDF', () => {
    renderImport();
    const input = screen.getByTestId('bid-document-import-file');
    expect(input).toHaveAttribute('type', 'file');
    expect(input.getAttribute('accept')).toContain('.json');
    expect(input.getAttribute('accept')).toContain('.csv');
    // PDF stays choosable in the OS file dialog -- it is no longer
    // "recognised, and refused" (see `BidDocumentImport.tsx`'s header, "A
    // fourth outcome"), it is read by a model.
    expect(input.getAttribute('accept')).toContain('.pdf');
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

  describe('choosing a file Sift recognises but will not read', () => {
    it('names the file, leaves the paste box empty, leaves the format unset, and blocks submit', async () => {
      const user = userEvent.setup();
      const { commands } = renderImport();

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File(['binary junk'], 'bid.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );

      const message = await screen.findByTestId('bid-document-import-file-unreadable');
      expect(message).toHaveTextContent('"bid.docx"');
      expect(message).toHaveTextContent('JSON or CSV');
      expect(screen.getByTestId('bid-document-import-text')).toHaveValue('');
      expect(screen.getByLabelText('Document format')).toHaveValue('');
      expect(screen.getByTestId('bid-document-import-submit')).toBeDisabled();
      expect(commands.submitBidDocument).not.toHaveBeenCalled();
      // No "derived from" / "cannot tell what format" note either: there is
      // no format reading to attribute to this file at all -- see
      // `unreadableBidDocumentMessage`.
      expect(screen.queryByTestId('bid-document-import-format-derived')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bid-document-import-format-unknown')).not.toBeInTheDocument();
    });

    // The paste box staying empty isn't a race: the file is never handed to
    // `FileReader` at all for this branch, so there is no read to race.
    it('never hands the file to FileReader', async () => {
      const user = userEvent.setup();
      renderImport();

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File(['binary junk'], 'bid.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );

      await screen.findByTestId('bid-document-import-file-unreadable');
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('');
      });
    });

    it('clears the message and imports normally once a readable file is chosen instead', async () => {
      const user = userEvent.setup();
      const { commands } = renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File(['binary junk'], 'bid.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      await screen.findByTestId('bid-document-import-file-unreadable');

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File([DOCUMENT_TEXT], 'bid-northgate.json', { type: 'application/json' }),
      );

      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue(DOCUMENT_TEXT);
      });
      expect(screen.queryByTestId('bid-document-import-file-unreadable')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Document format')).toHaveValue('application/json');

      await user.click(screen.getByTestId('bid-document-import-submit'));
      await waitFor(() => {
        expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
      });
    });

    it('lets the person clear the message by pasting real text and choosing a format by hand', async () => {
      const user = userEvent.setup();
      const { commands } = renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File(['binary junk'], 'bid.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      await screen.findByTestId('bid-document-import-file-unreadable');

      await user.clear(screen.getByLabelText('Document name'));
      await pasteDocument(user, 'scope,amount\nroof,1200\n', 'pasted-bid.csv', 'text/csv');
      expect(screen.queryByTestId('bid-document-import-file-unreadable')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('bid-document-import-submit'));
      await waitFor(() => {
        expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
      });
      expect(vi.mocked(commands.submitBidDocument).mock.calls[0]?.[0]).toMatchObject({
        document: { filename: 'pasted-bid.csv', format: 'text/csv' },
      });
    });

    it('has no axe violations while showing the unreadable-file message', async () => {
      const user = userEvent.setup();
      const { container } = renderImport();

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File(['binary junk'], 'bid.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      await screen.findByTestId('bid-document-import-file-unreadable');

      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('choosing a PDF -- read by a model, through a different command', () => {
    function pdfFile(name = 'bid-northgate.pdf') {
      return new File(['%PDF-1.4 unused -- extractPdfDocumentText is mocked'], name, {
        type: 'application/pdf',
      });
    }

    it('shows a pending state while extracting, then a ready state, with no format field at any point', async () => {
      const user = userEvent.setup();
      const pending = deferred<PdfTextExtractionResult>();
      extractPdfDocumentText.mockReturnValue(pending.promise);
      renderImport();

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());

      expect(await screen.findByTestId('bid-document-import-pdf-extracting')).toHaveTextContent(
        'Extracting text from "bid-northgate.pdf"',
      );
      // No format to confirm for a PDF -- see `BidDocumentImport.tsx`'s
      // header, "A fourth outcome".
      expect(screen.queryByLabelText('Document format')).not.toBeInTheDocument();
      expect(screen.getByTestId('bid-document-import-submit')).toBeDisabled();

      pending.resolve({ ok: true, text: 'Quoted total: $48,200' });

      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('Quoted total: $48,200');
      });
      const ready = screen.getByTestId('bid-document-import-pdf-ready');
      expect(ready).toHaveTextContent('"bid-northgate.pdf"');
      expect(ready).toHaveTextContent('read by a model');
      expect(screen.queryByLabelText('Document format')).not.toBeInTheDocument();
      expect(screen.getByTestId('bid-document-import-submit')).not.toBeDisabled();
    });

    it('imports through readBidDocument, never submitBidDocument, and the summary says a model read it', async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockResolvedValue({ ok: true, text: 'Quoted total: $48,200' });
      const { commands, onImported } = renderImport(
        {},
        { readBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('Quoted total: $48,200');
      });

      await user.click(screen.getByTestId('bid-document-import-submit'));

      await waitFor(() => {
        expect(commands.readBidDocument).toHaveBeenCalledTimes(1);
      });
      expect(commands.submitBidDocument).not.toHaveBeenCalled();
      const calledWith = vi.mocked(commands.readBidDocument).mock.calls[0]?.[0];
      expect(calledWith).toMatchObject({
        caseId: 'case-1',
        expectedSequence: 4,
        filename: 'bid-northgate.pdf',
        text: 'Quoted total: $48,200',
      });
      // Never sent, for the identical reason `submitBidDocument` never gets
      // one either: this affordance always ADDS an option.
      expect(calledWith?.optionId).toBeUndefined();

      // Told apart from a JSON/CSV import at both granularities: the
      // top-of-summary sentence and each field's own badge.
      const readerLine = await screen.findByTestId('bid-document-import-summary-reader');
      expect(readerLine).toHaveTextContent('A model read');
      const field = screen.getByTestId('bid-document-import-read-bid.quoted_total');
      expect(field).toHaveTextContent('Read by a model');

      expect(onImported).toHaveBeenCalledTimes(1);
    });

    it("shows the server's own message verbatim when this deployment has no model configured (503)", async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockResolvedValue({ ok: true, text: 'Quoted total: $48,200' });
      const serverMessage =
        'Reading a PDF bid document requires a model, and this deployment has none configured for it (SIFT_BID_DOCUMENT_READER_ENABLED is not enabled). Import the bid as a JSON or CSV file instead, or type its values in directly.';
      renderImport(
        {},
        {
          readBidDocument: vi.fn().mockRejectedValue(
            new SiftClientError(serverMessage, {
              status: 503,
              code: 'UNAVAILABLE',
              retryable: false,
            }),
          ),
        },
      );

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('Quoted total: $48,200');
      });

      await user.click(screen.getByTestId('bid-document-import-submit'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent(serverMessage);
      // Nothing here should read as the person's fault -- there is no
      // details list to imply the document itself was at fault either.
      expect(screen.queryByTestId('bid-document-import-error-details')).not.toBeInTheDocument();
    });

    it("surfaces the server's own reason when a reading produced nothing usable (400)", async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockResolvedValue({ ok: true, text: 'not really a bid document' });
      renderImport(
        {},
        {
          readBidDocument: vi.fn().mockRejectedValue(
            new SiftClientError('Could not read "bid-northgate.pdf" as a bid.', {
              status: 400,
              code: 'VALIDATION',
              retryable: false,
              details: ['The text named no quoted total, deposit, or contractor.'],
            }),
          ),
        },
      );

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue(
          'not really a bid document',
        );
      });

      await user.click(screen.getByTestId('bid-document-import-submit'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent('Could not read "bid-northgate.pdf" as a bid.');
      expect(screen.getByTestId('bid-document-import-error-details')).toHaveTextContent(
        'The text named no quoted total, deposit, or contractor.',
      );
    });

    it('reports a scanned PDF plainly, distinctly from a model reading finding nothing, and never calls readBidDocument', async () => {
      const user = userEvent.setup();
      const scannedMessage =
        '"scan.pdf" has no selectable text -- it looks like a scanned PDF or a set of page images, and there is nothing here for Sift to read. Export the bid as JSON or CSV, or type its values into the form above.';
      extractPdfDocumentText.mockResolvedValue({
        ok: false,
        reason: 'scanned',
        message: scannedMessage,
      });
      const { commands } = renderImport();

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile('scan.pdf'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent(scannedMessage);
      expect(commands.readBidDocument).not.toHaveBeenCalled();
      // The failed reading left no PDF-sourced text behind -- the format
      // field (which a PDF never shows) is back, because this is no longer
      // a live PDF import at all.
      expect(screen.getByLabelText('Document format')).toBeInTheDocument();
      expect(screen.getByTestId('bid-document-import-submit')).toBeDisabled();
    });

    it('reports a PDF pdfjs-dist could not parse at all, the same way, and never calls readBidDocument', async () => {
      const user = userEvent.setup();
      const unreadableMessage =
        '"corrupt.pdf" could not be read as a PDF (Invalid PDF structure.). Export the bid as JSON or CSV, or type its values into the form above.';
      extractPdfDocumentText.mockResolvedValue({
        ok: false,
        reason: 'unreadable',
        message: unreadableMessage,
      });
      const { commands } = renderImport();

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile('corrupt.pdf'));

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent(unreadableMessage);
      expect(commands.readBidDocument).not.toHaveBeenCalled();
    });

    it('clears the PDF state and imports normally once a JSON file is chosen instead', async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockResolvedValue({ ok: true, text: 'Quoted total: $48,200' });
      const { commands } = renderImport(
        {},
        { submitBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) },
      );

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('Quoted total: $48,200');
      });

      await user.upload(
        screen.getByTestId('bid-document-import-file'),
        new File([DOCUMENT_TEXT], 'bid-northgate.json', { type: 'application/json' }),
      );

      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue(DOCUMENT_TEXT);
      });
      // The format field is back -- this is a JSON import now, not a PDF one.
      expect(screen.getByLabelText('Document format')).toHaveValue('application/json');

      await user.click(screen.getByTestId('bid-document-import-submit'));

      await waitFor(() => {
        expect(commands.submitBidDocument).toHaveBeenCalledTimes(1);
      });
      expect(commands.readBidDocument).not.toHaveBeenCalled();
    });

    // Defense in depth: `extractPdfDocumentText` is documented never to
    // reject, but if it ever did, this component must still land on a real
    // sentence rather than an unhandled rejection reaching the console.
    it('reports a real sentence if extraction itself ever rejected outright', async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockRejectedValue(new Error('worker crashed'));
      const { commands } = renderImport();

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());

      const error = await screen.findByTestId('bid-document-import-error');
      expect(error).toHaveTextContent('worker crashed');
      expect(commands.readBidDocument).not.toHaveBeenCalled();
    });

    it('starting another import after a PDF one clears every PDF-specific state', async () => {
      const user = userEvent.setup();
      extractPdfDocumentText.mockResolvedValue({ ok: true, text: 'Quoted total: $48,200' });
      renderImport({}, { readBidDocument: vi.fn().mockResolvedValue(receiptWithImportedOption()) });

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await waitFor(() => {
        expect(screen.getByTestId('bid-document-import-text')).toHaveValue('Quoted total: $48,200');
      });
      await user.click(screen.getByTestId('bid-document-import-submit'));
      await screen.findByTestId('bid-document-import-summary');

      await user.click(screen.getByTestId('bid-document-import-another'));

      // Back to a blank form -- the format field is showing again (no PDF
      // is live any more), the text/filename are empty, and the summary is
      // gone.
      expect(screen.queryByTestId('bid-document-import-summary')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Document format')).toHaveValue('');
      expect(screen.getByTestId('bid-document-import-text')).toHaveValue('');
      expect(screen.getByTestId('bid-document-import-filename')).toHaveValue('');
    });

    it('has no axe violations while extracting, or while ready to import', async () => {
      const user = userEvent.setup();
      const pending = deferred<PdfTextExtractionResult>();
      extractPdfDocumentText.mockReturnValue(pending.promise);
      const { container } = renderImport();

      await user.upload(screen.getByTestId('bid-document-import-file'), pdfFile());
      await screen.findByTestId('bid-document-import-pdf-extracting');
      expect(await axe(container)).toHaveNoViolations();

      pending.resolve({ ok: true, text: 'Quoted total: $48,200' });
      await screen.findByTestId('bid-document-import-pdf-ready');
      expect(await axe(container)).toHaveNoViolations();
    });
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
