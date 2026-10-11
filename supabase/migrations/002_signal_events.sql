-- Group several outlets covering one event, and record whether a signal is about the partner or the firm.
alter table signals add column if not exists event text;   -- same id = several outlets covering one event
alter table signals add column if not exists about text;   -- partner | firm
