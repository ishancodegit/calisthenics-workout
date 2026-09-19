/* ------------------------------------------------------------------ */
/* Backups                                                             */
/*                                                                     */
/* The vault lives in one browser on one device. Storage can be wiped  */
/* by the user, by a storage squeeze, or by a reinstall, so the app    */
/* asks for a backup once there is enough in it to miss.               */
/* ------------------------------------------------------------------ */

import { exportAll, getMeta, setMeta, type Note } from "./notes-db";

const LAST_BACKUP = "last-backup-at";
const SNOOZE_UNTIL = "backup-snooze-until";

/** Below this many written pages, a nudge is just noise. */
const MIN_PAGES = 5;
/** A backup older than this, with edits since, counts as stale. */
const STALE_MS = 14 * 864e5;
const SNOOZE_MS = 7 * 864e5;

export type BackupState = { lastBackup: number; snoozeUntil: number };

export async function loadBackupState(): Promise<BackupState> {
  const [lastBackup, snoozeUntil] = await Promise.all([
    getMeta<number>(LAST_BACKUP),
    getMeta<number>(SNOOZE_UNTIL),
  ]);
  return { lastBackup: lastBackup ?? 0, snoozeUntil: snoozeUntil ?? 0 };
}

/** A page counts once it holds something worth losing. */
export function writtenPages(notes: Note[]): number {
  return notes.filter((n) => n.body.trim() || n.hasInk).length;
}

export function backupDue(notes: Note[], state: BackupState, now = Date.now()): boolean {
  if (now < state.snoozeUntil) return false;
  if (writtenPages(notes) < MIN_PAGES) return false;
  if (!state.lastBackup) return true;
  if (now - state.lastBackup < STALE_MS) return false;
  // Stale only matters if something actually changed since the last one.
  return notes.some((n) => n.updated > state.lastBackup);
}

export function backupReason(state: BackupState, now = Date.now()): string {
  if (!state.lastBackup) return "These pages only exist on this device";
  const days = Math.round((now - state.lastBackup) / 864e5);
  return `Last backup ${days} day${days === 1 ? "" : "s"} ago`;
}

export async function downloadBackup(): Promise<BackupState> {
  const backup = await exportAll();
  saveBlob(
    `notepad-backup-${new Date().toISOString().slice(0, 10)}.json`,
    new Blob([JSON.stringify(backup)], { type: "application/json" })
  );
  const now = Date.now();
  await setMeta(LAST_BACKUP, now);
  return { lastBackup: now, snoozeUntil: 0 };
}

export async function snoozeBackup(): Promise<BackupState> {
  const until = Date.now() + SNOOZE_MS;
  await setMeta(SNOOZE_UNTIL, until);
  const { lastBackup } = await loadBackupState();
  return { lastBackup, snoozeUntil: until };
}

export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
