-- Archived VCs. Kept in their own table so archiving never writes to vcs:
-- runs still touch only the four signal columns, and Vikram's notes stay intact for a restore.
create table if not exists vc_archive (
  id           bigint generated always as identity primary key,
  vc_id        bigint not null references vcs(id) on delete cascade,
  archived_at  timestamptz not null default now(),
  archived_by  text not null check (archived_by in ('rule', 'vikram')),
  reason       text,
  run_id       bigint references signal_runs(id) on delete set null,
  restored_at  timestamptz          -- set when Vikram restores the VC; history is kept
);
create unique index if not exists vc_archive_active on vc_archive (vc_id) where restored_at is null;
alter table vc_archive enable row level security;
