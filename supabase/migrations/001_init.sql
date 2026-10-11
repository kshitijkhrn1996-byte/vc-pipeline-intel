-- VC Pipeline Intelligence schema.
-- vcs: Vikram's pipeline. He owns every column except the four signal columns.
-- The pipeline can only write through apply_signal(), and a trigger blocks it
-- from touching anything else.

create table if not exists vcs (
  id               bigint generated always as identity primary key,
  -- Vikram's columns (never written by the pipeline)
  name             text not null,
  firm             text not null,
  thesis           text,
  email            text,
  website          text,
  blog_rss         text,
  status           text not null default 'yet_to_reach_out'
                   check (status in ('yet_to_reach_out','waiting_response','in_conversation','passed')),
  last_contact     date,
  contact_history  text,
  notes            text,
  -- Signal columns (the only ones the pipeline writes)
  last_signal_date   date,
  signal_summary     text,
  follow_up_score    int check (follow_up_score between 0 and 100),
  recommended_action text,
  unique (name, firm)
);

create table if not exists signal_runs (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  trigger        text not null,             -- 'cron' | 'manual'
  status         text not null default 'running', -- running | done | partial | failed
  vcs_checked    int default 0,
  signals_found  int default 0,
  protected_hash_before text,
  protected_hash_after  text,
  error          text
);

-- One row per VC per run: what was checked, the score, and the email draft.
create table if not exists vc_checks (
  id              bigint generated always as identity primary key,
  run_id          bigint not null references signal_runs(id) on delete cascade,
  vc_id           bigint not null references vcs(id) on delete cascade,
  checked_at      timestamptz not null default now(),
  sources_checked text[],
  items_found     int default 0,
  score           int,
  action_code     text,
  draft_subject   text,
  draft_body      text,
  unique (run_id, vc_id)
);

-- Evidence: every validated signal item, with its link.
create table if not exists signals (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references signal_runs(id) on delete cascade,
  vc_id       bigint not null references vcs(id) on delete cascade,
  source      text not null,          -- news | blog | search
  type        text not null,          -- investment | blog | interview | event | other
  title       text not null,
  url         text not null,
  published   date not null,
  relevance   int not null check (relevance between 0 and 3),
  summary     text,
  points      numeric
);
create index if not exists signals_vc_idx on signals (vc_id, run_id);
create index if not exists vc_checks_vc_idx on vc_checks (vc_id, checked_at desc);

-- Guard: when the pipeline is the writer, any change outside the four
-- signal columns aborts the transaction.
create or replace function guard_vikram_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('vc.writer', true), '') = 'pipeline' and (
       new.name            is distinct from old.name
    or new.firm            is distinct from old.firm
    or new.thesis          is distinct from old.thesis
    or new.email           is distinct from old.email
    or new.website         is distinct from old.website
    or new.blog_rss        is distinct from old.blog_rss
    or new.status          is distinct from old.status
    or new.last_contact    is distinct from old.last_contact
    or new.contact_history is distinct from old.contact_history
    or new.notes           is distinct from old.notes) then
    raise exception 'pipeline may only write signal columns (vc %)', old.id;
  end if;
  return new;
end $$;

drop trigger if exists vcs_guard on vcs;
create trigger vcs_guard before update on vcs
  for each row execute function guard_vikram_columns();

-- The only write path the pipeline uses.
create or replace function apply_signal(
  p_vc_id bigint, p_last_signal_date date, p_summary text, p_score int, p_action text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('vc.writer', 'pipeline', true);
  update vcs set
    last_signal_date   = coalesce(p_last_signal_date, last_signal_date),
    signal_summary     = p_summary,
    follow_up_score    = p_score,
    recommended_action = p_action
  where id = p_vc_id;
  perform set_config('vc.writer', '', true);
end $$;

-- Fingerprint of Vikram's columns, compared before/after each run.
create or replace function protected_hash() returns text
language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(
    concat_ws('|', id, name, firm, thesis, email, website, blog_rss, status,
              last_contact, contact_history, notes), E'\n' order by id), ''))
  from vcs
$$;

-- Lock down: only the server (service role) talks to these tables.
alter table vcs enable row level security;
alter table signal_runs enable row level security;
alter table vc_checks enable row level security;
alter table signals enable row level security;
revoke all on function apply_signal(bigint, date, text, int, text) from public, anon, authenticated;
revoke all on function protected_hash() from public, anon, authenticated;
grant execute on function apply_signal(bigint, date, text, int, text) to service_role;
grant execute on function protected_hash() to service_role;
