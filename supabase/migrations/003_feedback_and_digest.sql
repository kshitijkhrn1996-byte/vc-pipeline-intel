-- Vikram's verdict on individual signals. "not_relevant" items are excluded from future runs for that VC.
create table if not exists signal_feedback (
  id          bigint generated always as identity primary key,
  vc_id       bigint not null references vcs(id) on delete cascade,
  url         text not null,
  title       text,
  verdict     text not null check (verdict in ('useful', 'not_relevant')),
  created_at  timestamptz not null default now(),
  unique (vc_id, url)
);
alter table signal_feedback enable row level security;

-- Each scheduled run emails the brief once.
alter table signal_runs add column if not exists digest_sent_at timestamptz;
