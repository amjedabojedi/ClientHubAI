/**
 * Automated Tests for Communication Dictation RECOVERY
 *
 * These tests protect the "lost work on refresh / interruption" fix for the
 * chunked Communications dictation. The recorder persists a server-minted
 * uploadId (localStorage) plus failed-chunk audio (IndexedDB) so an
 * interrupted dictation can be recovered by finalizing whatever the server
 * still holds — WITHOUT telling the server how many chunks it expected.
 *
 * What this suite proves at the API level (the contract the recovery banner
 * depends on):
 *   1. An unfinalized dictation can be finalized via
 *      POST /api/communications/transcribe-finalize WITHOUT expectedChunks,
 *      and the server stitches and returns whatever chunks it received.
 *   2. Finalize returns 404 for an unknown / expired uploadId — exactly the
 *      case the UI treats as "dictation expired" and clears the stale pointer.
 *   3. (Regression guard for the data-loss safety the recovery path relies on)
 *      Finalize WITH expectedChunks greater than what the server holds returns
 *      409 so a normal save can't silently drop missing chunks — while the
 *      recovery path (no expectedChunks) still succeeds on the same upload.
 *   4. A second user cannot finalize someone else's upload (403).
 *   5. A finalized/recovered upload is consumed — finalizing it again is 404.
 *
 * Run with: npx tsx test/communications-transcribe-recovery.test.ts
 *
 * NOTES:
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   makes real HTTP requests, so the full middleware + handler chain (auth,
 *   consent gate, in-memory upload store, finalize stitching) is exercised.
 * - The OpenAI Whisper call is stubbed at the global `fetch` layer so each
 *   chunk transcribes to a deterministic string and no real API is hit.
 * - Seeds dedicated, uniquely-named users / clients / consent and removes them
 *   (and the audit rows they generate) at the end.
 * - Per .agents/memory/privacy-test-concurrency.md this app-level suite must
 *   run SERIALLY with the other privacy suites (it creates clients).
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { db } from "../server/db";
import {
  users,
  clients,
  auditLogs,
} from "../shared/schema";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";
import { storage } from "../server/storage";
import { inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
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

function assertEqual(actual: any, expected: any, message: string) {
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

// Each chunk index produces deterministic, distinct text so we can assert the
// server stitched the right pieces in the right order.
function chunkTextFor(index: number) {
  return `chunk ${index} words.`;
}

const SUFFIX = `t29-${Date.now()}`;

// Tracking for cleanup
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];

// ---------------------------------------------------------------------------
// Stub the OpenAI Whisper call (it goes through global fetch under the hood).
// We key the transcription off the chunk index encoded in the multipart body
// so each chunk gets distinct text.
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
function installFetchStub() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input?.url ?? String(input));
    if (url.includes("/audio/transcriptions")) {
      // The route names each uploaded chunk file `chunk-<index>.webm`; recover
      // the index from the multipart body so distinct chunks get distinct text.
      let index = 0;
      try {
        const body = init?.body;
        if (body && typeof body.getAll === "function") {
          const file: any = body.get("file");
          const name: string = file?.name || "";
          const m = name.match(/chunk-(\d+)/);
          if (m) index = parseInt(m[1], 10);
        }
      } catch {
        // fall back to index 0
      }
      return new Response(chunkTextFor(index), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeUser(role: string, label: string) {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x", // never used; auth is via minted token
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role,
  } as any);
  createdUserIds.push(user.id);
  return user;
}

async function makeClient(assignedTherapistId: number, label: string) {
  const client = await storage.createClient({
    fullName: `${label} ${SUFFIX}`,
    assignedTherapistId,
  } as any);
  createdClientIds.push(client.id);
  return client;
}

async function grantAiConsent(clientId: number) {
  await storage.createClientConsent({
    clientId,
    consentType: "ai_processing",
    consentVersion: "1.0",
    granted: true,
  } as any);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
let baseUrl = "";

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers["Cookie"] = `sessionToken=${token}`;
  return headers;
}

async function startUpload(token: string | null, clientId: number) {
  const res = await fetch(`${baseUrl}/api/communications/transcribe-start`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ clientId }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function sendChunk(
  token: string | null,
  uploadId: string,
  chunkIndex: number,
) {
  const fd = new FormData();
  fd.append("uploadId", uploadId);
  fd.append("chunkIndex", String(chunkIndex));
  fd.append(
    "audio",
    new Blob([Buffer.from(`fake-audio-${chunkIndex}`)], { type: "audio/webm" }),
    `chunk-${chunkIndex}.webm`,
  );
  const res = await fetch(`${baseUrl}/api/communications/transcribe-chunk`, {
    method: "POST",
    headers: authHeaders(token),
    body: fd,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function finalize(
  token: string | null,
  payload: Record<string, any>,
) {
  const res = await fetch(`${baseUrl}/api/communications/transcribe-finalize`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("\n🧪 Communication Dictation Recovery Tests\n");

  let server: Server | null = null;

  try {
    // --- Build the real app -------------------------------------------------
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Test server listening on ${baseUrl}\n`);

    installFetchStub();

    // --- Seed ---------------------------------------------------------------
    const therapist = await makeUser("therapist", "recover-therapist");
    const otherTherapist = await makeUser("therapist", "recover-other");
    const client = await makeClient(therapist.id, "recover-client");
    await grantAiConsent(client.id);
    // The "other" therapist gets their own consented client so they can mint a
    // valid upload of their own (used only to confirm cross-user isolation).
    const otherClient = await makeClient(otherTherapist.id, "recover-other-client");
    await grantAiConsent(otherClient.id);

    const token = createSessionToken(therapist);
    const otherToken = createSessionToken(otherTherapist);

    // =======================================================================
    // 1. Recovery happy path: start → send chunks → finalize WITHOUT
    //    expectedChunks recovers everything the server holds.
    // =======================================================================
    console.log("Test 1: Finalize without expectedChunks recovers server-held chunks");
    {
      const started = await startUpload(token, client.id);
      assertEqual(started.status, 200, "transcribe-start returns 200");
      const uploadId = String(started.body?.uploadId || "");
      assert(uploadId.startsWith("srv-"), "Server mints a srv- prefixed uploadId");

      const c0 = await sendChunk(token, uploadId, 0);
      assertEqual(c0.status, 200, "Chunk 0 accepted (200)");
      const c1 = await sendChunk(token, uploadId, 1);
      assertEqual(c1.status, 200, "Chunk 1 accepted (200)");

      // Simulate an interruption: the recorder never sent a normal finalize.
      // Recovery finalizes with NO expectedChunks, so the server stitches
      // whatever it received.
      const recovered = await finalize(token, { uploadId });
      assertEqual(recovered.status, 200, "Recovery finalize returns 200");
      assertEqual(
        recovered.body?.transcription,
        `${chunkTextFor(0)} ${chunkTextFor(1)}`,
        "Recovered transcription stitches all received chunks in order",
      );
    }

    // =======================================================================
    // 2. Finalize returns 404 for an unknown / expired uploadId.
    //    (The UI treats this as "dictation expired".)
    // =======================================================================
    console.log("\nTest 2: Finalize unknown uploadId returns 404");
    {
      const r = await finalize(token, { uploadId: "srv-doesnotexist0000000000000000" });
      assertEqual(r.status, 404, "Unknown uploadId returns 404");
    }

    // =======================================================================
    // 3. Data-loss safety: a NORMAL save (with expectedChunks) refuses to drop
    //    missing chunks (409), but the RECOVERY path (no expectedChunks) on the
    //    same upload still succeeds.
    // =======================================================================
    console.log("\nTest 3: expectedChunks mismatch blocks normal save but recovery still works");
    {
      const started = await startUpload(token, client.id);
      const uploadId = String(started.body?.uploadId || "");
      // Only chunk 0 makes it to the server; chunk 1 "failed" to upload.
      await sendChunk(token, uploadId, 0);

      const blocked = await finalize(token, { uploadId, expectedChunks: 2 });
      assertEqual(blocked.status, 409, "Normal finalize with missing chunk returns 409");
      assertEqual(blocked.body?.chunksReceived, 1, "409 reports chunksReceived=1");
      assertEqual(blocked.body?.chunksExpected, 2, "409 reports chunksExpected=2");

      // Recovery (no expectedChunks) saves what the server has rather than losing it.
      const recovered = await finalize(token, { uploadId });
      assertEqual(recovered.status, 200, "Recovery finalize (no expectedChunks) returns 200");
      assertEqual(
        recovered.body?.transcription,
        chunkTextFor(0),
        "Recovery returns the chunk the server did hold",
      );
    }

    // =======================================================================
    // 4. A different user cannot finalize someone else's upload (403).
    // =======================================================================
    console.log("\nTest 4: Cross-user finalize is rejected (403)");
    {
      const started = await startUpload(token, client.id);
      const uploadId = String(started.body?.uploadId || "");
      await sendChunk(token, uploadId, 0);

      const stolen = await finalize(otherToken, { uploadId });
      assertEqual(stolen.status, 403, "Another user finalizing the upload gets 403");

      // The rightful owner can still recover afterwards.
      const recovered = await finalize(token, { uploadId });
      assertEqual(recovered.status, 200, "Owner can still recover after the 403");
    }

    // =======================================================================
    // 5. An upload is consumed on finalize — recovering it twice is 404.
    // =======================================================================
    console.log("\nTest 5: A recovered upload cannot be recovered again (404)");
    {
      const started = await startUpload(token, client.id);
      const uploadId = String(started.body?.uploadId || "");
      await sendChunk(token, uploadId, 0);

      const first = await finalize(token, { uploadId });
      assertEqual(first.status, 200, "First recovery returns 200");
      const second = await finalize(token, { uploadId });
      assertEqual(second.status, 404, "Second recovery of the same upload returns 404");
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    // --- Cleanup -----------------------------------------------------------
    restoreFetch();
    try {
      if (createdClientIds.length > 0) {
        // audit_logs.clientId is ON DELETE SET NULL, so remove our audit rows first.
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdClientIds.length > 0) {
        // patient_consents cascade-delete with the client.
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error:", cleanupErr);
    }

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }

  // --- Summary -------------------------------------------------------------
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
    console.log("\n⚠️  Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Fatal error running tests:", error);
  restoreFetch();
  process.exit(1);
});
