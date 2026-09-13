import { describe, expect, it, vi } from 'vitest';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';

/**
 * `pdfjs-dist` itself is never exercised here -- it parses real PDF bytes
 * with a Web Worker, neither of which belongs in a unit test (this repo's
 * "no network, no real files over the wire" rule, and jsdom has no `Worker`
 * to give it). This double stands in for exactly the shape
 * `extractPdfDocumentText` reads off it: `getDocument(...)` returning a
 * loading task with `.promise` (resolving to a document with `numPages` and
 * `getPage`) and its own `.destroy()`, and each page's `getTextContent()`
 * resolving to `{ items }`. Everything this module does with that shape --
 * joining pages in reading order, detecting an empty text layer, enforcing
 * the byte cap -- is real, un-mocked code under test.
 *
 * `getDocument` and `GlobalWorkerOptions` are both built with `vi.hoisted`
 * -- `getDocument` because `vi.mock` itself is hoisted above every import in
 * this file (Vitest's own documented behaviour), so referencing a plain
 * `const` declared below it would read an uninitialized binding the moment
 * the mocked module is first imported. `GlobalWorkerOptions` for a second,
 * more deliberate reason: this file used to read it back via its own
 * top-level `import { GlobalWorkerOptions } from 'pdfjs-dist'`, but
 * `pdf-bid-document.ts` now loads `pdfjs-dist` lazily (this module's own
 * "Why the client API is a dynamic import" header), and that static import
 * would defeat the point -- it would resolve `pdfjs-dist` (and this mock
 * factory) the moment *this test file* loaded, before any test body ran,
 * making the "not loaded until extraction is called" test below pass no
 * matter what `pdf-bid-document.ts` actually does. Building the same object
 * via `vi.hoisted` instead gives every test a handle on it without ever
 * importing `pdfjs-dist` from here.
 */
const { getDocument, GlobalWorkerOptions } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- genuinely needed: `vi.hoisted`'s `T` is inferred straight from this literal, so dropping the assertion infers `GlobalWorkerOptions: {}` and every `.workerSrc` read below fails `tsc --noEmit` with "Property 'workerSrc' does not exist on type '{}'" (verified). The rule's typed-linting program disagrees with the real project build here.
  GlobalWorkerOptions: {} as { workerSrc?: string },
}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions,
  getDocument,
}));

import { extractPdfDocumentText } from './pdf-bid-document.js';

interface FakeTextItem {
  str: string;
  hasEOL?: boolean;
}

function fakePdfProxy(pages: FakeTextItem[][]) {
  return {
    numPages: pages.length,
    getPage: (pageNumber: number) =>
      Promise.resolve({
        getTextContent: () => Promise.resolve({ items: pages[pageNumber - 1] ?? [] }),
      }),
  };
}

/**
 * The `PDFDocumentLoadingTask`-shaped value `getDocument(...)` itself
 * returns -- `.destroy()` lives here, not on the resolved document
 * (`extractPdfDocumentText`'s own header explains why it reads it off this
 * object rather than the proxy `.promise` resolves to).
 */
function fakeLoadingTask(pages: FakeTextItem[][]) {
  return { promise: Promise.resolve(fakePdfProxy(pages)), destroy: vi.fn() };
}

function pdfFile(name = 'bid-northgate.pdf'): File {
  // The content never matters -- `getDocument` is mocked, so nothing here
  // ever actually parses these bytes as a PDF.
  return new File(['%PDF-1.4 unused in this test'], name, { type: 'application/pdf' });
}

describe('extractPdfDocumentText', () => {
  // The regression guard for this whole module's reason to exist (its own
  // header, "Why the client API is a dynamic import, not a static one"):
  // pdfjs-dist is close to 1 MB minified, and the entire point of
  // `loadPdfjs` is that nothing pays for it until a PDF is actually chosen.
  // `loadPdfjs` is the only code in `pdf-bid-document.ts` that ever writes
  // to `GlobalWorkerOptions.workerSrc`, and it does that only the first time
  // `extractPdfDocumentText` runs -- so finding it still unset here, before
  // any test in this file has called that function, is proof `pdfjs-dist`
  // has not loaded yet. Importing `pdf-bid-document.js` above did not
  // trigger it (that import is `import type`-only, erased at compile time --
  // see this test's own placement ahead of any test that calls
  // `extractPdfDocumentText`); this test MUST run first for that to hold,
  // which the declaration order above guarantees (Vitest runs `it`s in
  // declaration order by default, and this file sets no `sequence.shuffle`).
  // If a future edit ever turned the dynamic `import()` back into a static
  // one, `pdfjs-dist` would already be loaded by the time this test file's
  // own imports finished, and this assertion would fail.
  it('does not load pdfjs-dist until extraction is actually called', () => {
    expect(GlobalWorkerOptions.workerSrc).toBeUndefined();
  });

  it('configures the pdfjs worker lazily, the first time extraction actually loads it, via the Vite ?url asset URL', async () => {
    getDocument.mockReturnValue(fakeLoadingTask([[{ str: 'ok', hasEOL: true }]]));

    await extractPdfDocumentText(pdfFile());

    // Confirms the one thing a worker misconfiguration would silently skip:
    // this module actually sets `workerSrc`, to a real string Vite resolved
    // for `pdf.worker.min.mjs?url` -- not left at its unset default. Unlike
    // the old "at module load" version of this test, this one has to
    // actually call `extractPdfDocumentText` first, since loading pdfjs-dist
    // is no longer something merely importing this module does.
    expect(typeof GlobalWorkerOptions.workerSrc).toBe('string');
    expect(GlobalWorkerOptions.workerSrc).not.toBe('');
  });

  it('joins text items within a page with a space, unless the item says it ends a line', async () => {
    getDocument.mockReturnValue(
      fakeLoadingTask([
        [
          { str: 'Quoted total:', hasEOL: false },
          { str: '$48,200', hasEOL: true },
          { str: 'Warranty: 24 months', hasEOL: false },
        ],
      ]),
    );

    const result = await extractPdfDocumentText(pdfFile());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // `hasEOL: false` between "Quoted total:" and "$48,200" joins with a
    // space; `hasEOL: true` after "$48,200" starts a new line before
    // "Warranty: 24 months".
    expect(result.text).toContain('Quoted total: $48,200');
    expect(result.text).toContain('$48,200\nWarranty: 24 months');
  });

  it('joins pages in reading order, earlier pages first', async () => {
    getDocument.mockReturnValue(
      fakeLoadingTask([
        [{ str: 'Quoted total: $48,200', hasEOL: true }],
        [{ str: 'Warranty: 24 months', hasEOL: true }],
      ]),
    );

    const result = await extractPdfDocumentText(pdfFile());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.text).toContain('Quoted total: $48,200');
    expect(result.text).toContain('Warranty: 24 months');
    expect(result.text.indexOf('Quoted total')).toBeLessThan(result.text.indexOf('Warranty'));
  });

  it('reports a PDF with no text layer as a scan, distinctly from a model reading that found nothing', async () => {
    getDocument.mockReturnValue(fakeLoadingTask([[], []]));

    const result = await extractPdfDocumentText(pdfFile('scanned-bid.pdf'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('scanned');
    expect(result.message).toContain('"scanned-bid.pdf"');
    expect(result.message).toContain('scanned');
    expect(result.message).toContain('JSON or CSV');
    // Never describes this as a model's reading -- no model was ever
    // reached, since there was no text to send one.
    expect(result.message.toLowerCase()).not.toContain('model');
  });

  it('treats a text layer of only whitespace the same as no text layer at all', async () => {
    getDocument.mockReturnValue(fakeLoadingTask([[{ str: '   ', hasEOL: true }]]));

    const result = await extractPdfDocumentText(pdfFile());

    expect(result).toMatchObject({ ok: false, reason: 'scanned' });
  });

  it('refuses a text layer over MAX_BID_DOCUMENT_BYTES rather than truncating it', async () => {
    getDocument.mockReturnValue(
      fakeLoadingTask([[{ str: 'a'.repeat(MAX_BID_DOCUMENT_BYTES + 1), hasEOL: false }]]),
    );

    const result = await extractPdfDocumentText(pdfFile('big-bid.pdf'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('oversize');
    expect(result.message).toContain('256 KB');
    expect(result.message).toContain('Nothing was sent.');
  });

  it('accepts a text layer at exactly the cap', async () => {
    getDocument.mockReturnValue(
      fakeLoadingTask([[{ str: 'a'.repeat(MAX_BID_DOCUMENT_BYTES), hasEOL: false }]]),
    );

    const result = await extractPdfDocumentText(pdfFile());

    expect(result.ok).toBe(true);
  });

  it('reports a PDF pdfjs-dist could not parse as unreadable, naming the real reason', async () => {
    getDocument.mockReturnValue({
      // A real `PDFDocumentLoadingTask` carries `.destroy()` regardless of
      // whether `.promise` goes on to resolve or reject.
      promise: Promise.reject(new Error('Invalid PDF structure.')),
      destroy: vi.fn(),
    });

    const result = await extractPdfDocumentText(pdfFile('corrupt-bid.pdf'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unreadable');
    expect(result.message).toContain('"corrupt-bid.pdf"');
    expect(result.message).toContain('Invalid PDF structure.');
    expect(result.message).toContain('JSON or CSV');
  });

  // `pdfjs-dist` can reject with something that is not an `Error` at all
  // (a bare string, a plain object) -- the same "never invent a reason"
  // fallback this repo's other catch blocks already cover.
  it('falls back to a plain "unknown error" when pdfjs-dist rejects with something that is not an Error', async () => {
    getDocument.mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately a non-Error rejection value; that is exactly what this test exercises.
      promise: Promise.reject('not an Error instance'),
      destroy: vi.fn(),
    });

    const result = await extractPdfDocumentText(pdfFile('corrupt-bid.pdf'));

    expect(result).toMatchObject({ ok: false, reason: 'unreadable' });
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('an unknown error');
  });

  // A `TextMarkedContent` item (present only when `getTextContent` is asked
  // to include marked content, which `extractPdfDocumentText` never does,
  // but real PDFs can still surface non-text entries) carries no `str` at
  // all and must be skipped rather than joined in as `"undefined"`.
  it('skips a text-content item that carries no str', async () => {
    getDocument.mockReturnValue(
      fakeLoadingTask([
        [
          { str: 'Quoted total: $48,200', hasEOL: true },
          { type: 'beginMarkedContent' } as unknown as FakeTextItem,
          { str: 'Warranty: 24 months', hasEOL: true },
        ],
      ]),
    );

    const result = await extractPdfDocumentText(pdfFile());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.text).toContain('Quoted total: $48,200');
    expect(result.text).toContain('Warranty: 24 months');
    expect(result.text).not.toContain('undefined');
  });

  it('always frees the loading task, on success', async () => {
    const loadingTask = fakeLoadingTask([[{ str: 'ok', hasEOL: true }]]);
    getDocument.mockReturnValue(loadingTask);

    const result = await extractPdfDocumentText(pdfFile());

    expect(result.ok).toBe(true);
    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('still frees the loading task when the reading is refused as a scan', async () => {
    const loadingTask = fakeLoadingTask([[]]);
    getDocument.mockReturnValue(loadingTask);

    const result = await extractPdfDocumentText(pdfFile());

    expect(result).toMatchObject({ ok: false, reason: 'scanned' });
    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
  });

  // MUST stay the last test in this file: it overrides the `pdfjs-dist`
  // mock via `vi.doMock` and forces a fresh re-import of
  // `pdf-bid-document.js` via `vi.resetModules()`, and that override stays
  // in effect for every import that follows it in this worker for the rest
  // of the file. Simulates the chunk holding pdfjs-dist's client API
  // itself failing to arrive -- offline, or a stale hashed URL after a
  // redeploy retired this build's asset (this module's own header,
  // `loadPdfjs`) -- something `getDocument.mockReturnValue` cannot
  // reach, since that only stands in for pdfjs-dist's API once it has
  // already loaded.
  it('surfaces a failure to load the pdfjs module itself as the typed "unavailable" failure, not a throw', async () => {
    // A fresh module instance is required, not just a new mock return
    // value: `loadPdfjs`'s memoised promise is module-scope by design (see
    // this module's own header, "Why the client API is a dynamic import"),
    // and every earlier test in this file already drove it to a successful,
    // cached load. `vi.resetModules()` clears the module registry (without
    // touching the mock registrations `vi.mock`/`vi.doMock` set up) so the
    // re-import below gets its own `loadPdfjs` that has never been called.
    vi.resetModules();
    // The failure is modelled as `GlobalWorkerOptions.workerSrc` throwing
    // on assignment -- inside `loadPdfjs`'s own `.then()` -- rather than
    // the `vi.doMock` factory throwing directly. Vitest cannot tell a
    // factory that legitimately throws apart from one that broke its own
    // hoisting rules, and replaces whatever the factory throws with a
    // generic "there was an error when mocking a module" message either
    // way (confirmed empirically); throwing from inside the resolved
    // module's own code, same as a real "chunk failed to load" would
    // surface once something touches it, keeps the real error message
    // intact for the assertions below.
    vi.doMock('pdfjs-dist', () => ({
      getDocument,
      GlobalWorkerOptions: {
        set workerSrc(_value: string) {
          throw new Error('Failed to fetch dynamically imported module');
        },
      },
    }));

    const { extractPdfDocumentText: extractWithBrokenPdfjsLoad } =
      await import('./pdf-bid-document.js');

    const result = await extractWithBrokenPdfjsLoad(pdfFile('bid-northgate.pdf'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // Distinct from 'unreadable': nothing here ever opened the file, so
    // this must not read as a judgement on the PDF itself.
    expect(result.reason).toBe('unavailable');
    expect(result.message).toContain('"bid-northgate.pdf"');
    expect(result.message).toContain('Failed to fetch dynamically imported module');
    expect(result.message).toContain('JSON or CSV');
  });

  // The same "never invent a reason" fallback the analogous `unreadable`
  // test above (`falls back to a plain "unknown error" ...`) already covers
  // for a `getDocument(...)` rejection, exercised here for a pdfjs *load*
  // failure instead -- `pdfReaderUnavailableMessage`'s own `cause instanceof
  // Error` branch is otherwise never hit by anything else in this file.
  it('falls back to a plain "unknown error" when the pdfjs module fails to load with something that is not an Error', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist', () => ({
      getDocument,
      GlobalWorkerOptions: {
        set workerSrc(_value: string) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately a non-Error thrown value; that is exactly what this test exercises.
          throw 'not an Error instance';
        },
      },
    }));

    const { extractPdfDocumentText: extractWithBrokenPdfjsLoad } =
      await import('./pdf-bid-document.js');

    const result = await extractWithBrokenPdfjsLoad(pdfFile('corrupt-bid.pdf'));

    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('an unknown error');
  });
});
