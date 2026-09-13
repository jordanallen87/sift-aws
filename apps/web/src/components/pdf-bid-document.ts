/**
 * Turns a chosen PDF into the plain text `POST /api/cases/:caseId/
 * bid-documents/read` sends to a model (`ReadBidDocumentInputSchema.text`,
 * `@sift/contracts`) -- the one step `BidDocumentImport.tsx` needs before it
 * can hand a PDF to that route at all.
 *
 * ## Why a PDF needs a different route than JSON/CSV
 *
 * `submitBidDocument` (`bid-document-import.ts`'s own header) is
 * deterministic end to end, and `CommandService` is synchronous by design
 * (that command's own reasoning). A PDF's text layer is prose, not a
 * labelled field a deterministic extractor can key off of, so reading one
 * honestly requires a model -- and a model call cannot live inside a
 * synchronous command handler. `POST /api/cases/:caseId/bid-documents/read`
 * (`ReadBidDocumentInputSchema`) is the one seam where that model call
 * happens, async and strictly *before* the command, and -- like
 * `submitBidDocument` -- it takes text, never a file: there is no upload
 * endpoint here any more than there is for JSON/CSV
 * (`bid-document-import.ts`'s "No multipart upload"). This module is what
 * puts that text in the browser's hands: `pdfjs-dist` parses entirely
 * client-side, so a chosen PDF's bytes never leave the browser except as
 * the plain text `extractPdfDocumentText` returns.
 *
 * ## The worker
 *
 * `pdfjs-dist` parses off the main thread, in a Web Worker it loads from
 * whatever URL `GlobalWorkerOptions.workerSrc` names. The `?url` import
 * below asks Vite to emit `pdf.worker.min.mjs` as its own built asset and
 * hand back the URL it ends up at, rather than trying to fold a worker
 * script into this module's own chunk -- the one setup that keeps working
 * identically under `vite dev` (a dev-server URL) and `vite build` (a
 * hashed `/assets/...` URL in the production bundle); a worker
 * misconfiguration here is the kind of thing that passes dev and only fails
 * built, which is why `apps/web`'s build is run, not just its dev server,
 * before this module is trusted.
 *
 * ## Why the client API is a dynamic import, not a static one
 *
 * `pdfjs-dist`'s client API (`getDocument`, `GlobalWorkerOptions` -- as
 * distinct from the worker script above, which Vite already splits out via
 * `?url`) is close to 1 MB minified. A static `import` here would fold all
 * of that into `apps/web`'s main chunk, so every visitor pays for it on
 * first paint, including the large majority who never choose a PDF -- and
 * this product's canonical viewport is a ChatGPT side pane at 390-480px
 * (`apps/web/index.html`'s own header, `docs/design-system.md` "Layout"),
 * where first-load weight is felt directly, not amortised across a big
 * screen. `loadPdfjs` below turns that into a lazy `await import(...)`
 * Vite emits as its own chunk, fetched only once someone actually picks a
 * PDF. Do not "tidy" this back into a static import at the top of the
 * file -- that silently reintroduces the ~1 MB regression this comment
 * exists to prevent.
 */
// Type-only: erased at compile time, so importing from 'pdfjs-dist' here
// costs nothing at runtime and does not undo the dynamic `import()` in
// `loadPdfjs` below -- the values themselves are never pulled in statically.
import type * as PdfjsModule from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { bidDocumentSizeRefusal } from './bid-document-import.js';

/**
 * The in-flight (or already-settled) dynamic import of `pdfjs-dist`'s
 * client API, memoised at module scope so a second PDF chosen in the same
 * session reuses the first load instead of re-fetching the chunk. Reset to
 * `undefined` on failure (see `loadPdfjs`) rather than left holding a
 * rejected promise -- a settled `Promise` never changes state, so caching
 * a rejection would strand every later PDF behind the same failure even
 * after, say, connectivity comes back.
 */
let pdfjsModulePromise: Promise<typeof PdfjsModule> | undefined;

/**
 * Loads `pdfjs-dist`'s client API on demand and points it at the worker
 * asset URL Vite resolved for `pdf.worker.min.mjs?url` (this file's own
 * header, "The worker") -- done here, the first time the module actually
 * resolves, rather than at top level, since there is no module to
 * configure before this import settles.
 *
 * Left to reject on failure (an offline visitor, or a chunk 404 after a
 * redeploy retired this build's hashed asset): `extractPdfDocumentText`'s
 * own `try`/`catch` is what turns that rejection into the typed
 * `'unavailable'` result below, the same way it already turns a
 * `getDocument(...)` rejection into `'unreadable'`.
 */
function loadPdfjs(): Promise<typeof PdfjsModule> {
  pdfjsModulePromise ??= import('pdfjs-dist')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjs;
    })
    .catch((error: unknown) => {
      pdfjsModulePromise = undefined;
      throw error;
    });
  return pdfjsModulePromise;
}

/**
 * What `extractPdfDocumentText` found. Four failure reasons, not one
 * generic refusal, because each calls for a different sentence:
 *
 * - `'scanned'`: no text layer at all. A genuinely different situation from
 *   a model reading real text and finding no bid fields in it -- nothing
 *   here ever reached a model, so this is never described as a reading that
 *   came up empty (see `scannedPdfMessage`).
 * - `'oversize'`: a real text layer, too large to send -- the same cap
 *   `bidDocumentSizeRefusal` already enforces for a pasted JSON/CSV
 *   document, reused rather than restated so the two can never drift apart.
 * - `'unreadable'`: `pdfjs-dist` could not parse the file as a PDF at all
 *   (a corrupt file, a password-protected one, or one merely named `.pdf`).
 * - `'unavailable'`: `pdfjs-dist`'s client API itself -- loaded lazily, see
 *   `loadPdfjs` -- failed to load (offline, or a stale chunk URL after a
 *   redeploy). Kept distinct from `'unreadable'` on purpose: that reason
 *   describes something wrong with *this file*, while this one describes
 *   Sift's own reader failing to show up, chosen `.pdf` file never even
 *   examined -- folding it into `'unreadable'` would blame the file for a
 *   problem it does not have.
 */
export type PdfTextExtractionResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'scanned' | 'oversize' | 'unreadable' | 'unavailable'; message: string };

/**
 * The message for a PDF with no selectable text -- a scan, or a set of page
 * images. Deliberately distinct from anything a model reading might say:
 * nothing here ever reached a model, so this is not "the model found
 * nothing," it is "there was nothing here to hand a model in the first
 * place." Ends with the same real next steps
 * `unreadableBidDocumentMessage` (`bid-document-import.ts`) gives for every
 * other document Sift will not read.
 */
function scannedPdfMessage(fileName: string): string {
  return `"${fileName}" has no selectable text -- it looks like a scanned PDF or a set of page images, and there is nothing here for Sift to read. Export the bid as JSON or CSV, or type its values into the form above.`;
}

/**
 * The message for a PDF `pdfjs-dist` could not parse at all. Names the real
 * reason it gave, when it gave one -- the same "never invent a reason,
 * report the real one" rule `errorDetailLines` follows for a server
 * rejection in `BidDocumentImport.tsx`.
 */
function unreadablePdfMessage(fileName: string, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : 'an unknown error';
  return `"${fileName}" could not be read as a PDF (${reason}). Export the bid as JSON or CSV, or type its values into the form above.`;
}

/**
 * The message for `loadPdfjs` itself failing -- the chunk holding
 * `pdfjs-dist`'s client API never arrived, so `file` was never even opened.
 * Deliberately does not say "could not be read as a PDF" (`unreadablePdfMessage`'s
 * wording): that would blame the file for a reader that never showed up.
 * Names the real reason the same way `unreadablePdfMessage` does, and offers
 * a reload -- the one recovery that can actually fix this reason, unlike the
 * other three -- ahead of the usual JSON/CSV fallback.
 */
function pdfReaderUnavailableMessage(fileName: string, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : 'an unknown error';
  return `"${fileName}" could not be read -- Sift's PDF reader failed to load (${reason}). Reload the page and try again, or export the bid as JSON or CSV, or type its values into the form above.`;
}

/**
 * The items one page's `getTextContent()` resolves to -- derived from
 * `PDFPageProxy`'s own real method signature (`Awaited<ReturnType<...>>`)
 * rather than importing `pdfjs-dist`'s `TextItem`/`TextMarkedContent` types
 * by name. Those two live under `pdfjs-dist/types/src/display/api`, an
 * internal path outside the package's documented root export
 * (`main`/`types` in its own `package.json`); deriving the type from the
 * public `PDFPageProxy` class instead ties this module to real public API,
 * not an implementation detail `pdfjs-dist` is free to move.
 */
type PdfTextContentItems = Awaited<ReturnType<PdfjsModule.PDFPageProxy['getTextContent']>>['items'];

/**
 * Joins one page's text items in reading order: each item's `str`, in the
 * order `pdfjs-dist` laid them out on the page, with `hasEOL` deciding
 * whether the next item starts a new line or continues the same one. A
 * `TextMarkedContent` item -- only ever present when `getTextContent` is
 * asked to include marked content, which the call below never does --
 * carries no `str` at all and is skipped by the `'str' in item` guard,
 * which is also what narrows the union for the property access that
 * follows.
 */
function joinPageText(items: PdfTextContentItems): string {
  let text = '';
  for (const item of items) {
    if (!('str' in item)) continue;
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  }
  return text;
}

/**
 * Extracts a chosen PDF's text layer, page by page, joined in reading order
 * (`joinPageText`), and refuses rather than truncates when the result is
 * over `MAX_BID_DOCUMENT_BYTES` -- see `bidDocumentSizeRefusal`.
 *
 * Never rejects: every failure this function can hit -- the lazy
 * `pdfjs-dist` chunk itself failing to load, a file `pdfjs-dist` cannot
 * parse, a PDF with no text layer, a reading over the cap -- comes back as
 * `{ ok: false, reason, message }`, a real sentence the caller can show
 * directly, the same shape `FileReader.onerror` handling elsewhere in this
 * component already assumes. Two separate `try`/`catch` blocks are what
 * make that true, on purpose kept apart rather than merged into one: the
 * first isolates `loadPdfjs()` failing (reported as `'unavailable'`,
 * `file` never even opened) from the second, which is everything that can
 * go wrong once `pdfjs-dist` did load -- `getDocument(...).promise`,
 * `page.getTextContent()`, and `file.arrayBuffer()` all reject on a
 * real-world malformed or password-protected PDF, and every one of those
 * is reported as `'unreadable'` -- so neither failure is ever an unhandled
 * rejection reaching `BidDocumentImport.tsx`.
 */
export async function extractPdfDocumentText(file: File): Promise<PdfTextExtractionResult> {
  let pdfjs: typeof PdfjsModule;
  try {
    pdfjs = await loadPdfjs();
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      message: pdfReaderUnavailableMessage(file.name, error),
    };
  }
  const { getDocument } = pdfjs;

  // `getDocument` returns a `PDFDocumentLoadingTask`, not the document
  // itself -- `.promise` resolves to the `PDFDocumentProxy` this function
  // reads pages off, but `.destroy()` (in `finally`, below) lives on the
  // loading task, not on the resolved proxy. Declared outside the `try` so
  // that block can assign it the moment it exists and `finally` can still
  // reach it; left `undefined` when `file.arrayBuffer()` itself throws,
  // since there is then no loading task to destroy at all.
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    const buffer = await file.arrayBuffer();
    loadingTask = getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(joinPageText(content.items));
    }
    const text = pageTexts.join('\n\n').trim();

    if (text.length === 0) {
      return { ok: false, reason: 'scanned', message: scannedPdfMessage(file.name) };
    }

    const oversize = bidDocumentSizeRefusal(text);
    if (oversize !== null) {
      return { ok: false, reason: 'oversize', message: oversize };
    }

    return { ok: true, text };
  } catch (error) {
    return { ok: false, reason: 'unreadable', message: unreadablePdfMessage(file.name, error) };
  } finally {
    // Frees the worker-side document and its memory. Not awaited: nothing
    // downstream depends on teardown completing, and the result above is
    // already decided.
    void loadingTask?.destroy();
  }
}
