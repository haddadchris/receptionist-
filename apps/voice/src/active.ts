/** Calls currently connected to this voice-server instance (for /health and graceful shutdown). */
const active = new Set<string>();

export const trackCall = (id: string) => void active.add(id);
export const untrackCall = (id: string) => void active.delete(id);
export const activeCallCount = () => active.size;
