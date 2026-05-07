/**
 * IndexedDB-backed store for failed session-recording chunks.
 *
 * Why this exists: when a chunk upload fails 3× in a row, we keep the audio
 * Blob in `failedChunksRef` so the therapist can retry. That ref lives in
 * memory, so a tab refresh / accidental close used to throw the audio away
 * even though the recovery uploadId was persisted in localStorage.
 *
 * This module mirrors those failed blobs into IndexedDB keyed by uploadId so
 * after a refresh we can rehydrate the retry buttons with the original audio
 * and the user can re-send before saving — closing the last data-loss path.
 *
 * No PII concerns beyond the audio itself, which we already trust the
 * browser with for the duration of the recording. Entries are deleted as
 * soon as the chunk uploads successfully or the recording is finalized /
 * deleted / discarded.
 */

const DB_NAME = "smarthub-recording";
const DB_VERSION = 1;
const STORE = "failed-chunks";

export interface StoredFailedChunk {
  key: string; // `${uploadId}::${index}`
  uploadId: string;
  sessionId: number;
  index: number;
  durationSec: number;
  mime: string;
  blob: Blob;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("byUploadId", "uploadId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function makeKey(uploadId: string, index: number): string {
  return `${uploadId}::${index}`;
}

export async function putFailedChunk(
  entry: Omit<StoredFailedChunk, "key" | "savedAt">,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, "readwrite").put({
        ...entry,
        key: makeKey(entry.uploadId, entry.index),
        savedAt: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    // IDB errors are non-fatal — in-memory failedChunksRef still lets the
    // user retry within this session. Just log so we know if it's broken.
    console.warn("[recording-blob-store] put failed:", err);
  }
}

export async function deleteFailedChunk(
  uploadId: string,
  index: number,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, "readwrite").delete(makeKey(uploadId, index));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.warn("[recording-blob-store] delete failed:", err);
  }
}

export async function listFailedChunksForUpload(
  uploadId: string,
): Promise<StoredFailedChunk[]> {
  try {
    const db = await openDb();
    const result = await new Promise<StoredFailedChunk[]>((resolve, reject) => {
      const idx = tx(db, "readonly").index("byUploadId");
      const req = idx.getAll(IDBKeyRange.only(uploadId));
      req.onsuccess = () => resolve((req.result as StoredFailedChunk[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch (err) {
    console.warn("[recording-blob-store] list failed:", err);
    return [];
  }
}

export async function clearFailedChunksForUpload(
  uploadId: string,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, "readwrite");
      const idx = store.index("byUploadId");
      const cursorReq = idx.openCursor(IDBKeyRange.only(uploadId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    db.close();
  } catch (err) {
    console.warn("[recording-blob-store] clear failed:", err);
  }
}
