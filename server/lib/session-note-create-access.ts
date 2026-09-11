interface NoteAccessStorage {
  getSession(id: number): Promise<{ clientId: number; serviceId: number | null } | undefined>;
  getServiceById(id: number): Promise<{ therapistVisible: boolean | null; isActive: boolean | null } | null>;
}

// Authorization must inspect the selected record, never a paginated roster.
export async function canCreateSessionNote(
  storage: NoteAccessStorage,
  role: string,
  sessionId: number,
  clientId: number,
): Promise<boolean> {
  const session = await storage.getSession(sessionId);
  if (!session || Number(session.clientId) !== Number(clientId)) return false;
  if (role === "admin" || role === "administrator") return true;
  if (session.serviceId == null) return true;
  const service = await storage.getServiceById(session.serviceId);
  return service?.therapistVisible === true && service?.isActive === true;
}