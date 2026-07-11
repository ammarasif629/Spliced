/** <input type="date"> gives a bare YYYY-MM-DD; testimony.given_at stores ISO8601 UTC. */
export function dayToIso(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : null;
}

/** ISO8601 (or null) → the YYYY-MM-DD an <input type="date"> expects. */
export function isoToDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export const today = () => new Date().toISOString().slice(0, 10);
