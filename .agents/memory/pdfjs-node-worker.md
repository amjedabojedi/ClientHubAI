---
name: pdfjs-dist worker in Node
description: How to configure pdfjs-dist v5 for server-side PDF text extraction in Node without a 500.
---

# pdfjs-dist v5 worker setup in Node

`pdfjs-dist` v5 (legacy build, `pdfjs-dist/legacy/build/pdf.mjs`) requires
`GlobalWorkerOptions.workerSrc` to point at a **real, importable worker module**.
Setting it to an empty string (`''`) no longer works — getDocument throws
`Setting up fake worker failed: "No "GlobalWorkerOptions.workerSrc" specified."`
and the caller returns HTTP 500.

**Fix:** resolve the bundled worker to a `file://` URL before calling getDocument:
```
const moduleApi: any = await import('module');
const { pathToFileURL } = await import('url');
const require = moduleApi.createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
```

**Why:** v4→v5 removed the empty-string "use built-in fake worker" shortcut; the
fake-worker fallback now dynamically `import()`s whatever `workerSrc` names, so it
must be a valid path/URL.

**How to apply:** Any server-side PDF parsing path (template extraction +
supporting-file extraction both go through `extractPdf` in
`server/report-templates/extract.ts`). Works because the server build uses
esbuild `--packages=external`, so `pdfjs-dist` is runtime-resolved from
node_modules. Revisit if the build ever becomes a single self-contained bundle.
