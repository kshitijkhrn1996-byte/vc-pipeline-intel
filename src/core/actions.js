// Action rules: follow-up score × Vikram's own status × days since he last contacted the VC.
import { daysBetween } from './scoring.js';

export const ACTIVE_THRESHOLD = 30;   // score at which a VC is "worth reaching out to"
export const NUDGE_AFTER_DAYS = 10;   // don't chase a pending reply sooner than this

export const ACTIONS = {
  REACH_OUT_NOW: 'Reach out now',
  NUDGE_NOW: 'Nudge now',
  HOLD_AWAITING_REPLY: 'Hold: awaiting reply',
  CONTINUE: 'Continue conversation',
  DEPRIORITISE: 'Deprioritise this week',
  SKIP_PASSED: 'Skip: passed',
};

export function decideAction({ score, status, lastContact }, today) {
  const sinceContact = lastContact ? daysBetween(lastContact, today) : null;
  const active = score >= ACTIVE_THRESHOLD;
  switch (status) {
    case 'passed':
      return { code: 'SKIP_PASSED', label: ACTIONS.SKIP_PASSED };
    case 'in_conversation':
      return { code: 'CONTINUE', label: active ? `${ACTIONS.CONTINUE}: mention their recent signal` : ACTIONS.CONTINUE };
    case 'waiting_response':
      if (sinceContact !== null && sinceContact <= NUDGE_AFTER_DAYS)
        return { code: 'HOLD_AWAITING_REPLY', label: `${ACTIONS.HOLD_AWAITING_REPLY} (contacted ${sinceContact}d ago)` };
      return active
        ? { code: 'NUDGE_NOW', label: `${ACTIONS.NUDGE_NOW}: follow up using their signal` }
        : { code: 'DEPRIORITISE', label: `${ACTIONS.DEPRIORITISE}: quiet, nudge when they resurface` };
    default: // yet_to_reach_out
      return active
        ? { code: 'REACH_OUT_NOW', label: `${ACTIONS.REACH_OUT_NOW}: open with their signal` }
        : { code: 'DEPRIORITISE', label: `${ACTIONS.DEPRIORITISE}: no relevant activity` };
  }
}

export const DRAFT_ACTIONS = new Set(['REACH_OUT_NOW', 'NUDGE_NOW']);
