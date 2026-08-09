-- Research Workspace core data model.
-- Private records are scoped to auth.users through user_id and protected by RLS.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assert_workspace_links_match_user()
returns trigger
language plpgsql
as $$
declare
  payload jsonb := to_jsonb(new);
  link_id uuid;
begin
  if payload ? 'project_id' and nullif(payload->>'project_id', '') is not null then
    link_id := (payload->>'project_id')::uuid;
    if not exists (
      select 1 from public.projects
      where id = link_id and user_id = new.user_id
    ) then
      raise exception 'project_id must reference a project owned by the same user';
    end if;
  end if;

  if payload ? 'paper_id' and nullif(payload->>'paper_id', '') is not null then
    link_id := (payload->>'paper_id')::uuid;
    if not exists (
      select 1 from public.papers
      where id = link_id and user_id = new.user_id
    ) then
      raise exception 'paper_id must reference a paper owned by the same user';
    end if;
  end if;

  if payload ? 'paper_figure_id' and nullif(payload->>'paper_figure_id', '') is not null then
    link_id := (payload->>'paper_figure_id')::uuid;
    if not exists (
      select 1 from public.paper_figures
      where id = link_id and user_id = new.user_id
    ) then
      raise exception 'paper_figure_id must reference a figure owned by the same user';
    end if;
  end if;

  if payload ? 'experience_id' and nullif(payload->>'experience_id', '') is not null then
    link_id := (payload->>'experience_id')::uuid;
    if not exists (
      select 1 from public.experiences
      where id = link_id and user_id = new.user_id
    ) then
      raise exception 'experience_id must reference an experience owned by the same user';
    end if;
  end if;

  if payload ? 'portfolio_item_id' and nullif(payload->>'portfolio_item_id', '') is not null then
    link_id := (payload->>'portfolio_item_id')::uuid;
    if not exists (
      select 1 from public.portfolio_items
      where id = link_id and user_id = new.user_id
    ) then
      raise exception 'portfolio_item_id must reference a portfolio item owned by the same user';
    end if;
  end if;

  return new;
end;
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  slug text,
  summary text,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'paused', 'completed', 'archived')),
  progress smallint not null default 0 check (progress between 0 and 100),
  started_on date,
  target_on date,
  completed_on date,
  next_action text,
  is_archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index projects_user_slug_idx
  on public.projects(user_id, slug)
  where slug is not null;
create index projects_user_status_idx on public.projects(user_id, status);

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  citation_key text,
  authors text[] not null default array[]::text[],
  journal text,
  publication_year integer check (publication_year between 1500 and 2500),
  doi text,
  url text,
  abstract text,
  status text not null default 'reading'
    check (status in ('to_read', 'reading', 'reviewed', 'analysis', 'drafting', 'manuscript', 'submitted', 'published', 'archived')),
  progress smallint not null default 0 check (progress between 0 and 100),
  deadline_on date,
  published_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index papers_user_citation_key_idx
  on public.papers(user_id, citation_key)
  where citation_key is not null;
create index papers_user_status_idx on public.papers(user_id, status);
create index papers_project_idx on public.papers(project_id);

create trigger papers_set_updated_at
before update on public.papers
for each row execute function public.set_updated_at();

create trigger papers_assert_workspace_links
before insert or update on public.papers
for each row execute function public.assert_workspace_links_match_user();

create table public.paper_figures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  figure_label text,
  title text,
  caption text,
  asset_url text,
  source_page integer check (source_page is null or source_page > 0),
  figure_type text not null default 'figure'
    check (figure_type in ('figure', 'table', 'scheme', 'graph', 'image', 'supporting')),
  status text not null default 'draft'
    check (status in ('draft', 'needs_revision', 'ready', 'submitted', 'archived')),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index paper_figures_label_idx
  on public.paper_figures(paper_id, figure_label)
  where figure_label is not null;
create index paper_figures_user_status_idx on public.paper_figures(user_id, status);
create index paper_figures_project_idx on public.paper_figures(project_id);

create trigger paper_figures_set_updated_at
before update on public.paper_figures
for each row execute function public.set_updated_at();

create trigger paper_figures_assert_workspace_links
before insert or update on public.paper_figures
for each row execute function public.assert_workspace_links_match_user();

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  category text,
  role text,
  organization text,
  situation text,
  task text,
  action text,
  result text,
  reflection text,
  tags text[] not null default array[]::text[],
  occurred_on date,
  visibility text not null default 'private'
    check (visibility in ('private', 'portfolio', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index experiences_user_visibility_idx on public.experiences(user_id, visibility);
create index experiences_project_idx on public.experiences(project_id);

create trigger experiences_set_updated_at
before update on public.experiences
for each row execute function public.set_updated_at();

create trigger experiences_assert_workspace_links
before insert or update on public.experiences
for each row execute function public.assert_workspace_links_match_user();

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  paper_id uuid references public.papers(id) on delete set null,
  experience_id uuid references public.experiences(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  summary text,
  body text,
  item_type text not null default 'case_study'
    check (item_type in ('case_study', 'project', 'paper', 'figure', 'experience', 'note', 'link')),
  visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  featured boolean not null default false,
  sort_order integer not null default 0,
  asset_url text,
  external_url text,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portfolio_items_user_visibility_idx on public.portfolio_items(user_id, visibility);
create index portfolio_items_public_idx
  on public.portfolio_items(featured, sort_order, published_at desc)
  where visibility = 'public';
create index portfolio_items_project_idx on public.portfolio_items(project_id);

create trigger portfolio_items_set_updated_at
before update on public.portfolio_items
for each row execute function public.set_updated_at();

create trigger portfolio_items_assert_workspace_links
before insert or update on public.portfolio_items
for each row execute function public.assert_workspace_links_match_user();

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  paper_id uuid references public.papers(id) on delete set null,
  paper_figure_id uuid references public.paper_figures(id) on delete set null,
  experience_id uuid references public.experiences(id) on delete set null,
  portfolio_item_id uuid references public.portfolio_items(id) on delete set null,
  title text,
  body text not null default '',
  note_type text not null default 'research'
    check (note_type in ('research', 'paper', 'figure', 'career', 'meeting', 'idea', 'portfolio')),
  tags text[] not null default array[]::text[],
  is_pinned boolean not null default false,
  visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(coalesce(title, '') || body)) > 0)
);

create index notes_user_type_idx on public.notes(user_id, note_type);
create index notes_project_idx on public.notes(project_id);
create index notes_paper_idx on public.notes(paper_id);
create index notes_paper_figure_idx on public.notes(paper_figure_id);
create index notes_experience_idx on public.notes(experience_id);
create index notes_portfolio_item_idx on public.notes(portfolio_item_id);

create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

create trigger notes_assert_workspace_links
before insert or update on public.notes
for each row execute function public.assert_workspace_links_match_user();

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  paper_id uuid references public.papers(id) on delete set null,
  paper_figure_id uuid references public.paper_figures(id) on delete set null,
  experience_id uuid references public.experiences(id) on delete set null,
  portfolio_item_id uuid references public.portfolio_items(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done', 'canceled')),
  priority smallint not null default 3 check (priority between 1 and 5),
  due_on date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index todos_user_status_idx on public.todos(user_id, status);
create index todos_user_due_on_idx on public.todos(user_id, due_on);
create index todos_project_idx on public.todos(project_id);
create index todos_paper_idx on public.todos(paper_id);
create index todos_paper_figure_idx on public.todos(paper_figure_id);
create index todos_experience_idx on public.todos(experience_id);
create index todos_portfolio_item_idx on public.todos(portfolio_item_id);

create trigger todos_set_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

create trigger todos_assert_workspace_links
before insert or update on public.todos
for each row execute function public.assert_workspace_links_match_user();

alter table public.projects enable row level security;
alter table public.papers enable row level security;
alter table public.paper_figures enable row level security;
alter table public.experiences enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.notes enable row level security;
alter table public.todos enable row level security;

create policy "Users manage own projects"
on public.projects
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users manage own papers"
on public.papers
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users manage own paper figures"
on public.paper_figures
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users manage own experiences"
on public.experiences
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users manage own portfolio items"
on public.portfolio_items
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Public portfolio items are readable"
on public.portfolio_items
for select
using (visibility = 'public' and published_at is not null);

create policy "Users manage own notes"
on public.notes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Public notes are readable"
on public.notes
for select
using (visibility = 'public');

create policy "Users manage own todos"
on public.todos
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
