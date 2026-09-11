import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canCreateSessionNote } from "../server/lib/session-note-create-access";

function fixture(service: { therapistVisible: boolean; isActive: boolean } | null = {
  therapistVisible: true, isActive: true,
}) {
  return {
    async getSession(id: number) {
      return id === 15001 ? { clientId: 42, serviceId: 7 } : undefined;
    },
    async getServiceById() { return service; },
    async getSessionsWithFiltering() {
      throw new Error("A paginated list must never authorize note creation");
    },
  };
}

test("visible selected session is allowed without scanning any paginated roster", async () => {
  assert.equal(await canCreateSessionNote(fixture(), "therapist", 15001, 42), true);
});

test("hidden, inactive, and missing services remain blocked for non-admins", async () => {
  for (const service of [
    { therapistVisible: false, isActive: true },
    { therapistVisible: true, isActive: false },
    null,
  ]) {
    assert.equal(await canCreateSessionNote(fixture(service), "therapist", 15001, 42), false);
  }
});

test("both admin role names retain hidden-service access", async () => {
  for (const role of ["admin", "administrator"]) {
    assert.equal(await canCreateSessionNote(
      fixture({ therapistVisible: false, isActive: true }), role, 15001, 42,
    ), true);
  }
});

test("missing sessions and mismatched clients are rejected even for admins", async () => {
  for (const role of ["therapist", "admin"]) {
    assert.equal(await canCreateSessionNote(fixture(), role, 15002, 42), false);
    assert.equal(await canCreateSessionNote(fixture(), role, 15001, 43), false);
  }
});

test("sessions without a service remain eligible", async () => {
  const storage = { ...fixture(), async getSession() { return { clientId: 42, serviceId: null }; } };
  assert.equal(await canCreateSessionNote(storage, "therapist", 15001, 42), true);
});