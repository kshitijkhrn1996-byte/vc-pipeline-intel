// Auto-archive rule: a VC with no public signal for ARCHIVE_AFTER_DAYS is archived at the end of a run.
import { daysBetween } from './scoring.js';

export const ARCHIVE_AFTER_DAYS = Number(process.env.ARCHIVE_AFTER_DAYS || 60);

// vc: { status, last_signal_date }; firstChecked: date the system first checked this VC;
// lastRestored: date Vikram last restored it (or null).
export function shouldArchive({ vc, firstChecked, lastRestored }, today, days = ARCHIVE_AFTER_DAYS) {
  if (vc.status === 'in_conversation') return null;                       // never while he is talking to them
  if (!firstChecked || daysBetween(firstChecked, today) < days) return null; // give every VC the full window
  if (lastRestored && daysBetween(lastRestored, today) < days) return null;  // a restore buys another window
  if (vc.last_signal_date && daysBetween(vc.last_signal_date, today) < days) return null;
  return vc.last_signal_date
    ? `No public signal since ${vc.last_signal_date} (over ${days} days)`
    : `No public signal in ${daysBetween(firstChecked, today)} days of tracking`;
}
