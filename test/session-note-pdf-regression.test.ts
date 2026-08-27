/**
 * Regression coverage for the saved session-note PDF export.
 *
 * This deliberately exercises the real Express route and Chromium renderer:
 *   - an authenticated therapist downloads a saved/finalized note;
 *   - the response is a PDF with the expected filename;
 *   - the note's safe text survives PDF rendering and spans multiple pages;
 *   - executable markup cannot replace the rendered clinical document.
 *
 * Run with: npx tsx test/session-note-pdf-regression.test.ts
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  clients,
  services,
  sessions,
  sessionNotes,
} from "../shared/schema";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";
import { storage } from "../server/storage";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

/**
 * PDF.js is also used by the server for document extraction. Keeping the
 * extraction here avoids asserting against compressed PDF bytes, which would
 * not prove that text made it through the actual PDF rendering pipeline.
 */
async function extractPdfText(buffer: Buffer): Promise<{
  pageCount: number;
  text: string;
}> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const moduleApi: any = await import("module");
  const { pathToFileURL } = await import("url");
  const nodeRequire = moduleApi.createRequire(import.meta.url);
  const workerPath = nodeRequire.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  );

  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item: any) => (typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" "),
    );
  }

  await document.destroy();
  return { pageCount, text: pages.join("\n\n") };
}

const SUFFIX = `t-pdf-regression-${Date.now()}`;
const FIRST_PAGE_MARKER = `PDF_NOTE_FIRST_MARKER_${SUFFIX}`;
const LAST_PAGE_MARKER = `PDF_NOTE_LAST_MARKER_${SUFFIX}`;
const SAFE_MARKER = `PDF_NOTE_SAFE_MARKER_${SUFFIX}`;
const UNSAFE_MARKER = `PDF_NOTE_SCRIPT_INJECTED_${SUFFIX}`;

const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdSessionNoteIds: number[] = [];

let baseUrl = "";

async function run() {
  console.log("\n🧪 Session-Note PDF Rendering Regression Tests\n");

  let server: Server | null = null;

  try {
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Test server listening on ${baseUrl}\n`);

    const therapist = await storage.createUser({
      username: `pdf-render-owner-${SUFFIX}`,
      password: "x",
      fullName: `PDF Render Owner ${SUFFIX}`,
      email: `pdf-render-owner-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    createdUserIds.push(therapist.id);

    const client = await storage.createClient({
      fullName: `PDF Render Client ${SUFFIX}`,
      assignedTherapistId: therapist.id,
    } as any);
    createdClientIds.push(client.id);

    const service = await storage.createService({
      serviceCode: `PDF-REG-${SUFFIX}`,
      serviceName: `PDF Rendering Regression Service ${SUFFIX}`,
      duration: 60,
      baseRate: "100.00",
      isActive: true,
      therapistVisible: true,
      clientPortalVisible: true,
    } as any);
    createdServiceIds.push(service.id);

    const session = await storage.createSession({
      clientId: client.id,
      therapistId: therapist.id,
      serviceId: service.id,
      sessionDate: new Date("2026-08-27T15:00:00.000Z"),
      sessionType: "individual",
      status: "completed",
    } as any);
    createdSessionIds.push(session.id);

    // The repeated paragraphs intentionally exceed one A4 page. The script
    // attempts to replace the whole document if note markup is not sanitized.
    const longClinicalContent = [
      `<p>${FIRST_PAGE_MARKER}: The saved session note begins here.</p>`,
      `<p>${SAFE_MARKER}: This text must remain visible in the PDF.</p>`,
      `<script>document.body.innerHTML = '<p>${UNSAFE_MARKER}</p>'</script>`,
      ...Array.from(
        { length: 220 },
        (_, index) =>
          `<p>Clinical observation ${index + 1}: The client discussed coping
          strategies, treatment goals, progress, and follow-up planning for
          this session. ${SUFFIX}</p>`,
      ),
      `<p>${LAST_PAGE_MARKER}: The saved session note ends here.</p>`,
    ].join("\n");

    const note = await storage.createSessionNote({
      sessionId: session.id,
      clientId: client.id,
      therapistId: therapist.id,
      date: new Date("2026-08-27T15:05:00.000Z"),
      // Keep a different generated value so this also proves the saved final
      // content, rather than an unsaved fallback, is what was rendered.
      generatedContent: `<p>WRONG_GENERATED_CONTENT_${SUFFIX}</p>`,
      draftContent: `<p>WRONG_DRAFT_CONTENT_${SUFFIX}</p>`,
      finalContent: longClinicalContent,
      isDraft: false,
      isFinalized: true,
      finalizedAt: new Date("2026-08-27T16:00:00.000Z"),
      aiEnabled: false,
    } as any);
    createdSessionNoteIds.push(note.id);

    const response = await fetch(
      `${baseUrl}/api/session-notes/${note.id}/pdf`,
      {
        headers: {
          Cookie: `sessionToken=${createSessionToken(therapist)}`,
        },
      },
    );
    const pdfBytes = Buffer.from(await response.arrayBuffer());

    assertEqual(response.status, 200, "Authenticated therapist receives the saved note PDF");
    assertEqual(
      response.headers.get("content-type"),
      "application/pdf",
      "PDF response has the application/pdf content type",
    );
    assertEqual(
      response.headers.get("content-disposition"),
      `inline; filename="session-note-${note.id}.pdf"`,
      "PDF response advertises the expected downloaded filename",
    );
    assertEqual(
      Number(response.headers.get("content-length")),
      pdfBytes.length,
      "PDF response content length matches the downloaded bytes",
    );
    assert(
      pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-")),
      "Downloaded bytes start with the PDF signature",
    );

    const rendered = await extractPdfText(pdfBytes);
    assert(
      rendered.pageCount > 1,
      `Long saved note renders across multiple pages (${rendered.pageCount} pages)`,
    );
    assert(
      rendered.text.includes(FIRST_PAGE_MARKER),
      "Text from the beginning of the saved note survives PDF rendering",
    );
    assert(
      rendered.text.includes(LAST_PAGE_MARKER),
      "Text from the end of the saved note survives multi-page rendering",
    );
    assert(
      rendered.text.includes(SAFE_MARKER),
      "Safe note text remains present after sanitization",
    );
    assert(
      !rendered.text.includes(UNSAFE_MARKER),
      "Executable note markup cannot inject text into the PDF",
    );
    assert(
      !rendered.text.includes(`WRONG_GENERATED_CONTENT_${SUFFIX}`) &&
        !rendered.text.includes(`WRONG_DRAFT_CONTENT_${SUFFIX}`),
      "The rendered PDF uses the saved final note content",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    try {
      if (createdSessionNoteIds.length > 0) {
        await db
          .delete(sessionNotes)
          .where(inArray(sessionNotes.id, createdSessionNoteIds));
      }
      if (createdSessionIds.length > 0) {
        await db
          .delete(sessions)
          .where(inArray(sessions.id, createdSessionIds));
      }
      if (createdClientIds.length > 0) {
        await db
          .delete(clients)
          .where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db
          .delete(services)
          .where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(users)
          .where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupError) {
      console.error("⚠️ Cleanup error:", cleanupError);
    }

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("\n⚠️ Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});