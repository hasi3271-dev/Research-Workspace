-- Import support: stable source keys make repeated imports idempotent.
-- raw_data preserves unknown fields from planner.json, portfolio.json, and research-note.json.

alter table public.projects
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.papers
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.paper_figures
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.experiences
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.portfolio_items
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.notes
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

alter table public.todos
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

create unique index if not exists projects_user_source_key_idx
  on public.projects(user_id, source_key);

create unique index if not exists papers_user_source_key_idx
  on public.papers(user_id, source_key);

create unique index if not exists paper_figures_user_source_key_idx
  on public.paper_figures(user_id, source_key);

create unique index if not exists experiences_user_source_key_idx
  on public.experiences(user_id, source_key);

create unique index if not exists portfolio_items_user_source_key_idx
  on public.portfolio_items(user_id, source_key);

create unique index if not exists notes_user_source_key_idx
  on public.notes(user_id, source_key);

create unique index if not exists todos_user_source_key_idx
  on public.todos(user_id, source_key);
