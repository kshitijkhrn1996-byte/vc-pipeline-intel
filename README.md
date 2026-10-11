# VC Pipeline Intelligence

MESA Cohort C4 · AI and its Applications, Section 1 Final · "VC Fundraising Pipeline Intelligence" (High difficulty).

Vikram is raising Seed for a B2B logistics SaaS and tracks 50 VCs. Twice a week, before he works his pipeline, this system
checks each VC's public activity from the last 30 days, scores how receptive they are likely to be right now, recommends an
action, and drafts the outreach email. It updates **only** the four signal columns of his Supabase table and never touches
his notes or contact history.

## How it works

```
Vercel Cron (Mon & Thu, 6:30 + 8:30 IST)  ─┐     Dashboard "Run now" ─┐
                                           ▼                          ▼
                                   /api/run  (chunked, resumable, 240 s budget per call)
                                           │
   Supabase vcs (read) ─► collectors: Google News RSS (partner + firm deals) · firm blog RSS
                          · Gemini + Google Search grounding when the feeds find nothing (URL must load)
                       ─► validator: real URL, dated, inside 30 days, de-duplicated
                       ─► Gemini Flash (JSON schema): about this VC? type · relevance 0-3 · summary · event id
                       ─► scoring (src/scoring.js): type × relevance × recency, one count per event, off-topic capped
                       ─► action rules: score × Vikram's status × days since last contact
                       ─► Gemini Flash: email drafts for "Reach out now" / "Nudge now"
                       ─► apply_signal() RPC: writes ONLY last_signal_date, signal_summary, follow_up_score, recommended_action
                       ─► vc_checks (drafts, sources), signals (evidence links), signal_runs (notes fingerprint before/after)
Dashboard (public/index.html + /api/vcs) ◄─ ranked list · evidence · quiet list · drafts → Gmail · editable notes
```

## Protecting Vikram's notes

1. **Code:** the pipeline never updates `vcs` directly. Its only write is the `apply_signal()` Postgres function.
2. **Database:** `apply_signal()` sets only the four signal columns. A `BEFORE UPDATE` trigger raises an error if a
   pipeline write changes any of Vikram's columns.
3. **Proof:** each run stores an MD5 fingerprint of Vikram's columns before and after (`protected_hash()`). The dashboard
   shows "✓ untouched" when they match.

## Layout

| Path | What |
|---|---|
| `api/run.js` | Cron + manual run endpoint |
| `api/vcs.js` | Dashboard data; Vikram's edits (whitelisted columns only) |
| `lib/sources.js`, `lib/rss.js` | Live collectors: Google News, blog RSS, Gemini search grounding |
| `lib/gemini.js` | Classification and email drafts (Gemini Flash, structured output) |
| `lib/pipeline.js` | The run: collect → validate → classify → score → act → draft → write |
| `src/scoring.js`, `src/validate.js` | Deterministic scoring, action rules, evidence validation (unit-tested) |
| `sql/schema.sql` | Tables, guard trigger, `apply_signal()`, `protected_hash()` |
| `data/vcs.json`, `scripts/seed.js` | 50 researched VCs; seed with fictional relationship history |
| `public/index.html` | Dashboard |

## Run

```bash
npm install
npm test
node --env-file=.env scripts/dry-run.js "Prime Venture" "Blume"
npx vercel deploy --prod
```

Env: `GEMINI_API_KEY`, `GEMINI_MODEL` (gemini-3.5-flash), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_KEY`, `CRON_SECRET`.
Optional: `FOUNDER_NAME`, `COMPANY_NAME`, `COMPANY_PITCH`.

## Assumptions and limits

- "Worth reaching out" = follow-up score ≥ 30, which needs at least one logistics/B2B-relevant signal. Off-topic activity adds at most 15.
- Don't nudge a pending reply until 10 days after last contact.
- Firm-level deals count as signals for the partner, and are labelled "firm signal".
- LinkedIn and X posts are not covered (no free API; scraping breaks their terms). News, firm blogs and web search are.
- VC contact emails are firm-level public addresses only; personal addresses were deliberately not collected.
