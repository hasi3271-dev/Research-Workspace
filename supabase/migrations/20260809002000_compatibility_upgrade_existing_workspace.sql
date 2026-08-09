-- Compatibility upgrade for an existing private Research Workspace database.
--
-- This migration is intentionally non-destructive:
-- - no DROP TABLE
-- - no TRUNCATE
-- - no destructive renames
-- - only CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, nullable backfills,
--   NOT VALID foreign keys, RLS policies, triggers, and legacy-table copies.

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

create or replace function public.rw_try_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or value = '' then
    return null;
  end if;

  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.rw_try_date(value text)
returns date
language plpgsql
immutable
as $$
begin
  if value is null or value = '' or lower(value) = 'tbd' then
    return null;
  end if;

  return value::date;
exception
  when invalid_datetime_format then
    return null;
  when datetime_field_overflow then
    return null;
end;
$$;

create or replace function public.rw_column_exists(p_table_name text, p_column_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table_name
      and column_name = p_column_name
  );
$$;

create or replace function public.rw_column_is_nullable(p_table_name text, p_column_name text)
returns boolean
language sql
stable
as $$
  select coalesce((
    select is_nullable = 'YES'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table_name
      and column_name = p_column_name
  ), true);
$$;

create or replace function public.rw_column_udt_name(p_schema_name text, p_table_name text, p_column_name text)
returns text
language sql
stable
as $$
  select udt_name
  from information_schema.columns
  where table_schema = p_schema_name
    and table_name = p_table_name
    and column_name = p_column_name;
$$;

create or replace function public.rw_column_is_uuid(p_schema_name text, p_table_name text, p_column_name text)
returns boolean
language sql
stable
as $$
  select coalesce(public.rw_column_udt_name(p_schema_name, p_table_name, p_column_name) = 'uuid', false);
$$;

create or replace function public.rw_add_fk_if_possible(
  table_name text,
  constraint_name text,
  column_name text,
  ref_schema text,
  ref_table text,
  ref_column text,
  delete_action text default 'set null'
)
returns void
language plpgsql
as $$
begin
  if to_regclass(format('public.%I', table_name)) is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = constraint_name
      and conrelid = format('public.%I', table_name)::regclass
  ) then
    return;
  end if;

  if not public.rw_column_is_uuid('public', table_name, column_name) then
    raise notice 'Skipping %.% foreign key: column is missing or is not uuid', table_name, column_name;
    return;
  end if;

  if not public.rw_column_is_uuid(ref_schema, ref_table, ref_column) then
    raise notice 'Skipping %.% foreign key: referenced column %.% is missing or is not uuid',
      table_name, column_name, ref_table, ref_column;
    return;
  end if;

  execute format(
    'alter table public.%I add constraint %I foreign key (%I) references %I.%I(%I) on delete %s not valid',
    table_name,
    constraint_name,
    column_name,
    ref_schema,
    ref_table,
    ref_column,
    delete_action
  );
end;
$$;

create or replace function public.rw_create_source_index_if_safe(table_name text, index_name text)
returns void
language plpgsql
as $$
declare
  duplicate_count bigint;
begin
  if to_regclass(format('public.%I', table_name)) is null then
    return;
  end if;

  if to_regclass(format('public.%I', index_name)) is not null then
    return;
  end if;

  if public.rw_column_udt_name('public', table_name, 'source_key') not in ('text', 'varchar') then
    raise notice 'Skipping unique source index % because %.source_key is not text', index_name, table_name;
    return;
  end if;

  execute format(
    'select count(*) from (
       select user_id::text, source_key
       from public.%I
       where source_key is not null
       group by user_id::text, source_key
       having count(*) > 1
     ) duplicates',
    table_name
  )
  into duplicate_count;

  if duplicate_count > 0 then
    raise notice 'Skipping unique source index % because duplicate source_key values already exist in %',
      index_name,
      table_name;
    return;
  end if;

  execute format('create unique index %I on public.%I(user_id, source_key)', index_name, table_name);
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
  if not (payload ? 'user_id') or payload->>'user_id' is null or payload->>'user_id' = '' then
    return new;
  end if;

  if payload ? 'project_id' then
    link_id := public.rw_try_uuid(payload->>'project_id');
    if link_id is not null and not exists (
      select 1 from public.projects
      where id::text = link_id::text and user_id::text = payload->>'user_id'
    ) then
      raise exception 'project_id must reference a project owned by the same user';
    end if;
  end if;

  if payload ? 'paper_id' then
    link_id := public.rw_try_uuid(payload->>'paper_id');
    if link_id is not null and not exists (
      select 1 from public.papers
      where id::text = link_id::text and user_id::text = payload->>'user_id'
    ) then
      raise exception 'paper_id must reference a paper owned by the same user';
    end if;
  end if;

  if payload ? 'paper_figure_id' then
    link_id := public.rw_try_uuid(payload->>'paper_figure_id');
    if link_id is not null and not exists (
      select 1 from public.paper_figures
      where id::text = link_id::text and user_id::text = payload->>'user_id'
    ) then
      raise exception 'paper_figure_id must reference a figure owned by the same user';
    end if;
  end if;

  if payload ? 'experience_id' then
    link_id := public.rw_try_uuid(payload->>'experience_id');
    if link_id is not null and not exists (
      select 1 from public.experiences
      where id::text = link_id::text and user_id::text = payload->>'user_id'
    ) then
      raise exception 'experience_id must reference an experience owned by the same user';
    end if;
  end if;

  if payload ? 'portfolio_item_id' then
    link_id := public.rw_try_uuid(payload->>'portfolio_item_id');
    if link_id is not null and not exists (
      select 1 from public.portfolio_items
      where id::text = link_id::text and user_id::text = payload->>'user_id'
    ) then
      raise exception 'portfolio_item_id must reference a portfolio item owned by the same user';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text,
  slug text,
  summary text,
  status text default 'planning',
  progress smallint default 0,
  started_on date,
  target_on date,
  completed_on date,
  next_action text,
  is_archived boolean default false,
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid,
  title text,
  citation_key text,
  authors text[] default array[]::text[],
  journal text,
  publication_year integer,
  doi text,
  url text,
  abstract text,
  status text default 'reading',
  progress smallint default 0,
  deadline_on date,
  published_on date,
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_figures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  paper_id uuid,
  project_id uuid,
  figure_label text,
  title text,
  caption text,
  asset_url text,
  source_page integer,
  figure_type text default 'figure',
  status text default 'draft',
  sort_order integer default 0,
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid,
  title text,
  category text,
  role text,
  organization text,
  situation text,
  task text,
  action text,
  result text,
  reflection text,
  tags text[] default array[]::text[],
  occurred_on date,
  visibility text default 'private',
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid,
  paper_id uuid,
  experience_id uuid,
  title text,
  summary text,
  body text,
  item_type text default 'case_study',
  visibility text default 'private',
  featured boolean default false,
  sort_order integer default 0,
  asset_url text,
  external_url text,
  published_at timestamptz,
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid,
  paper_id uuid,
  paper_figure_id uuid,
  experience_id uuid,
  portfolio_item_id uuid,
  title text,
  body text default '',
  note_type text default 'research',
  tags text[] default array[]::text[],
  is_pinned boolean default false,
  visibility text default 'private',
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid,
  paper_id uuid,
  paper_figure_id uuid,
  experience_id uuid,
  portfolio_item_id uuid,
  title text,
  description text,
  status text default 'open',
  priority smallint default 3,
  due_on date,
  completed_at timestamptz,
  sort_order integer default 0,
  source_file text,
  source_key text,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists slug text,
  add column if not exists summary text,
  add column if not exists status text default 'planning',
  add column if not exists progress smallint default 0,
  add column if not exists started_on date,
  add column if not exists target_on date,
  add column if not exists completed_on date,
  add column if not exists next_action text,
  add column if not exists is_archived boolean default false,
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.papers
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists title text,
  add column if not exists citation_key text,
  add column if not exists authors text[] default array[]::text[],
  add column if not exists journal text,
  add column if not exists publication_year integer,
  add column if not exists doi text,
  add column if not exists url text,
  add column if not exists abstract text,
  add column if not exists status text default 'reading',
  add column if not exists progress smallint default 0,
  add column if not exists deadline_on date,
  add column if not exists published_on date,
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.paper_figures
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists paper_id uuid,
  add column if not exists project_id uuid,
  add column if not exists figure_label text,
  add column if not exists title text,
  add column if not exists caption text,
  add column if not exists asset_url text,
  add column if not exists source_page integer,
  add column if not exists figure_type text default 'figure',
  add column if not exists status text default 'draft',
  add column if not exists sort_order integer default 0,
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.experiences
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists role text,
  add column if not exists organization text,
  add column if not exists situation text,
  add column if not exists task text,
  add column if not exists action text,
  add column if not exists result text,
  add column if not exists reflection text,
  add column if not exists tags text[] default array[]::text[],
  add column if not exists occurred_on date,
  add column if not exists visibility text default 'private',
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.portfolio_items
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists paper_id uuid,
  add column if not exists experience_id uuid,
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists body text,
  add column if not exists item_type text default 'case_study',
  add column if not exists visibility text default 'private',
  add column if not exists featured boolean default false,
  add column if not exists sort_order integer default 0,
  add column if not exists asset_url text,
  add column if not exists external_url text,
  add column if not exists published_at timestamptz,
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.notes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists paper_id uuid,
  add column if not exists paper_figure_id uuid,
  add column if not exists experience_id uuid,
  add column if not exists portfolio_item_id uuid,
  add column if not exists title text,
  add column if not exists body text default '',
  add column if not exists note_type text default 'research',
  add column if not exists tags text[] default array[]::text[],
  add column if not exists is_pinned boolean default false,
  add column if not exists visibility text default 'private',
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.todos
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists paper_id uuid,
  add column if not exists paper_figure_id uuid,
  add column if not exists experience_id uuid,
  add column if not exists portfolio_item_id uuid,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists status text default 'open',
  add column if not exists priority smallint default 3,
  add column if not exists due_on date,
  add column if not exists completed_at timestamptz,
  add column if not exists sort_order integer default 0,
  add column if not exists source_file text,
  add column if not exists source_key text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  table_name text;
  duplicate_count bigint;
begin
  foreach table_name in array array[
    'projects',
    'papers',
    'paper_figures',
    'experiences',
    'portfolio_items',
    'notes',
    'todos'
  ]
  loop
    if public.rw_column_is_uuid('public', table_name, 'id') then
      execute format('update public.%I set id = gen_random_uuid() where id is null', table_name);
      execute format('alter table public.%I alter column id set default gen_random_uuid()', table_name);

      execute format(
        'select count(*) from (
           select id
           from public.%I
           group by id
           having count(*) > 1
         ) duplicates',
        table_name
      )
      into duplicate_count;

      if not exists (
        select 1
        from pg_constraint
        where conrelid = format('public.%I', table_name)::regclass
          and contype = 'p'
      )
      and duplicate_count = 0
      then
        execute format('alter table public.%I add primary key (id)', table_name);
      elsif duplicate_count > 0 then
        raise notice 'Skipping primary key on % because duplicate id values already exist', table_name;
      end if;
    else
      raise notice 'Skipping id default and primary key on % because id is not uuid', table_name;
    end if;

    if public.rw_column_udt_name('public', table_name, 'source_file') not in ('text', 'varchar')
      or public.rw_column_udt_name('public', table_name, 'source_key') not in ('text', 'varchar')
    then
      raise notice 'Skipping source metadata backfill on % because source_file/source_key are not text columns', table_name;
    elsif public.rw_column_udt_name('public', table_name, 'raw_data') = 'jsonb' then
      execute format(
        'update public.%I t
         set source_file = coalesce(source_file, %L),
             source_key = coalesce(source_key, %L || coalesce(to_jsonb(t)->>''id'', md5(to_jsonb(t)::text))),
             raw_data = case when raw_data = ''{}''::jsonb then to_jsonb(t) - ''raw_data'' else raw_data end
         where source_file is null or source_key is null or raw_data = ''{}''::jsonb',
        table_name,
        'legacy-existing-' || table_name,
        'legacy:' || table_name || ':'
      );
    else
      raise notice 'Skipping raw_data backfill on % because raw_data is not jsonb', table_name;
      execute format(
        'update public.%I t
         set source_file = coalesce(source_file, %L),
             source_key = coalesce(source_key, %L || coalesce(to_jsonb(t)->>''id'', md5(to_jsonb(t)::text)))
         where source_file is null or source_key is null',
        table_name,
        'legacy-existing-' || table_name,
        'legacy:' || table_name || ':'
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if public.rw_column_exists('projects', 'name') then
    update public.projects set title = coalesce(title, to_jsonb(projects)->>'name') where title is null;
  end if;

  if public.rw_column_exists('papers', 'name') then
    update public.papers set title = coalesce(title, to_jsonb(papers)->>'name') where title is null;
  end if;

  if public.rw_column_exists('todos', 'task') then
    update public.todos set title = coalesce(title, to_jsonb(todos)->>'task') where title is null;
  end if;

  if public.rw_column_exists('todos', 'done') and public.rw_column_udt_name('public', 'todos', 'status') in ('text', 'varchar') then
    update public.todos
    set status = 'done',
        completed_at = coalesce(completed_at, now())
    where coalesce(to_jsonb(todos)->>'done', 'false') in ('true', 't', '1', 'yes')
      and coalesce(status, 'open') = 'open';
  end if;

  if public.rw_column_exists('notes', 'content') then
    update public.notes set body = coalesce(nullif(body, ''), to_jsonb(notes)->>'content') where body is null or body = '';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.research_notes') is not null then
    insert into public.notes (
      user_id,
      title,
      body,
      note_type,
      tags,
      visibility,
      source_file,
      source_key,
      raw_data,
      metadata
    )
    select
      public.rw_try_uuid(j->>'user_id'),
      coalesce(j->>'title', j->>'name'),
      coalesce(j->>'body', j->>'content', j->>'text', j->>'note', j->>'summary', 'Imported research note'),
      'research',
      array[]::text[],
      case when j->>'visibility' = 'public' then 'public' else 'private' end,
      'research_notes',
      'legacy:research_notes:' || coalesce(nullif(j->>'id', ''), md5(j::text)),
      j,
      jsonb_build_object('legacy_table', 'research_notes')
    from (select to_jsonb(r) as j from public.research_notes r) legacy
    where (public.rw_column_is_nullable('notes', 'user_id') or public.rw_try_uuid(j->>'user_id') is not null)
      and not exists (
        select 1
        from public.notes n
        where n.source_key = 'legacy:research_notes:' || coalesce(nullif(j->>'id', ''), md5(j::text))
      );
  end if;
end;
$$;

do $$
declare
  legacy_table text;
begin
  foreach legacy_table in array array['portfolio', 'portfolios']
  loop
    if to_regclass(format('public.%I', legacy_table)) is not null then
      execute format(
        'insert into public.portfolio_items (
           user_id,
           title,
           summary,
           body,
           item_type,
           visibility,
           featured,
           external_url,
           source_file,
           source_key,
           raw_data,
           metadata
         )
         select
           public.rw_try_uuid(j->>''user_id''),
           coalesce(j->>''title'', j->>''name'', j->>''project'', j->>''role'', ''Imported portfolio item''),
           coalesce(j->>''summary'', j->>''description'', j->>''subtitle''),
           coalesce(j->>''body'', j->>''content'', j->>''details''),
           case
             when coalesce(j->>''item_type'', j->>''type'') in (''case_study'', ''project'', ''paper'', ''figure'', ''experience'', ''note'', ''link'')
             then coalesce(j->>''item_type'', j->>''type'')
             else ''case_study''
           end,
           case when coalesce(j->>''public'', ''false'') in (''true'', ''t'', ''1'', ''yes'') or j->>''visibility'' = ''public'' then ''public'' else ''private'' end,
           coalesce(j->>''featured'', ''false'') in (''true'', ''t'', ''1'', ''yes''),
           coalesce(j->>''external_url'', j->>''url'', j->>''link''),
           %L,
           %L || coalesce(nullif(j->>''id'', ''''), md5(j::text)),
           j,
           jsonb_build_object(''legacy_table'', %L)
         from (select to_jsonb(t) as j from public.%I t) legacy
         where (public.rw_column_is_nullable(''portfolio_items'', ''user_id'') or public.rw_try_uuid(j->>''user_id'') is not null)
           and not exists (
             select 1
             from public.portfolio_items p
             where p.source_key = %L || coalesce(nullif(j->>''id'', ''''), md5(j::text))
           )',
        legacy_table,
        'legacy:' || legacy_table || ':',
        legacy_table,
        legacy_table,
        'legacy:' || legacy_table || ':'
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.figures') is not null then
    insert into public.paper_figures (
      user_id,
      paper_id,
      project_id,
      figure_label,
      title,
      caption,
      status,
      source_file,
      source_key,
      raw_data,
      metadata
    )
    select
      public.rw_try_uuid(j->>'user_id'),
      public.rw_try_uuid(j->>'paper_id'),
      public.rw_try_uuid(j->>'project_id'),
      coalesce(j->>'figure_label', j->>'label', j->>'number'),
      coalesce(j->>'title', j->>'name', j->>'claim', j->>'label', 'Imported figure'),
      j->>'caption',
      case
        when j->>'status' in ('draft', 'needs_revision', 'ready', 'submitted', 'archived') then j->>'status'
        else 'draft'
      end,
      'figures',
      'legacy:figures:' || coalesce(nullif(j->>'id', ''), md5(j::text)),
      j,
      jsonb_build_object(
        'legacy_table', 'figures',
        'claim', j->'claim',
        'data', j->'data',
        'next', coalesce(j->>'next', j->>'next_action'),
        'reference', coalesce(j->>'reference', j->>'ref')
      )
    from (select to_jsonb(f) as j from public.figures f) legacy
    where (public.rw_column_is_nullable('paper_figures', 'user_id') or public.rw_try_uuid(j->>'user_id') is not null)
      and (public.rw_column_is_nullable('paper_figures', 'paper_id') or public.rw_try_uuid(j->>'paper_id') is not null)
      and not exists (
        select 1
        from public.paper_figures pf
        where pf.source_key = 'legacy:figures:' || coalesce(nullif(j->>'id', ''), md5(j::text))
      );
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.paper_tasks') is not null then
    insert into public.todos (
      user_id,
      paper_id,
      paper_figure_id,
      title,
      description,
      status,
      priority,
      due_on,
      source_file,
      source_key,
      raw_data,
      metadata
    )
    select
      public.rw_try_uuid(j->>'user_id'),
      public.rw_try_uuid(j->>'paper_id'),
      public.rw_try_uuid(j->>'paper_figure_id'),
      coalesce(j->>'title', j->>'task', j->>'name', j->>'next', 'Imported paper task'),
      coalesce(j->>'description', j->>'body', j->>'note'),
      case
        when coalesce(j->>'done', 'false') in ('true', 't', '1', 'yes') then 'done'
        when j->>'status' in ('open', 'in_progress', 'blocked', 'done', 'canceled') then j->>'status'
        else 'open'
      end,
      case
        when coalesce(j->>'priority', '') ~ '^[0-9]+$'
        then greatest(1, least(5, (j->>'priority')::integer))
        when lower(coalesce(j->>'priority', '')) in ('urgent', 'highest', 'high') then 1
        when lower(coalesce(j->>'priority', '')) in ('low', 'lowest') then 5
        else 3
      end,
      public.rw_try_date(coalesce(j->>'due_on', j->>'due_date', j->>'date', j->>'deadline')),
      'paper_tasks',
      'legacy:paper_tasks:' || coalesce(nullif(j->>'id', ''), md5(j::text)),
      j,
      jsonb_build_object('legacy_table', 'paper_tasks')
    from (select to_jsonb(pt) as j from public.paper_tasks pt) legacy
    where (public.rw_column_is_nullable('todos', 'user_id') or public.rw_try_uuid(j->>'user_id') is not null)
      and not exists (
        select 1
        from public.todos t
        where t.source_key = 'legacy:paper_tasks:' || coalesce(nullif(j->>'id', ''), md5(j::text))
      );
  end if;
end;
$$;

do $$
begin
  if public.rw_column_udt_name('public', 'todos', 'priority') in ('int2', 'int4', 'int8', 'numeric') then
    update public.todos set priority = 3 where priority is null;
  end if;

  if public.rw_column_udt_name('public', 'projects', 'status') in ('text', 'varchar') then
    update public.projects set status = 'planning' where status is null;
  end if;

  if public.rw_column_udt_name('public', 'papers', 'status') in ('text', 'varchar') then
    update public.papers set status = 'reading' where status is null;
  end if;

  if public.rw_column_udt_name('public', 'paper_figures', 'status') in ('text', 'varchar') then
    update public.paper_figures set status = 'draft' where status is null;
  end if;

  if public.rw_column_udt_name('public', 'experiences', 'visibility') in ('text', 'varchar') then
    update public.experiences set visibility = 'private' where visibility is null;
  end if;

  if public.rw_column_udt_name('public', 'portfolio_items', 'visibility') in ('text', 'varchar') then
    update public.portfolio_items set visibility = 'private' where visibility is null;
  end if;

  if public.rw_column_udt_name('public', 'notes', 'visibility') in ('text', 'varchar') then
    update public.notes set visibility = 'private' where visibility is null;
  end if;
end;
$$;

select public.rw_add_fk_if_possible('projects', 'projects_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('papers', 'papers_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('papers', 'papers_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('paper_figures', 'paper_figures_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('paper_figures', 'paper_figures_paper_id_fkey', 'paper_id', 'public', 'papers', 'id', 'cascade');
select public.rw_add_fk_if_possible('paper_figures', 'paper_figures_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('experiences', 'experiences_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('experiences', 'experiences_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('portfolio_items', 'portfolio_items_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('portfolio_items', 'portfolio_items_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('portfolio_items', 'portfolio_items_paper_id_fkey', 'paper_id', 'public', 'papers', 'id', 'set null');
select public.rw_add_fk_if_possible('portfolio_items', 'portfolio_items_experience_id_fkey', 'experience_id', 'public', 'experiences', 'id', 'set null');
select public.rw_add_fk_if_possible('notes', 'notes_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('notes', 'notes_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('notes', 'notes_paper_id_fkey', 'paper_id', 'public', 'papers', 'id', 'set null');
select public.rw_add_fk_if_possible('notes', 'notes_paper_figure_id_fkey', 'paper_figure_id', 'public', 'paper_figures', 'id', 'set null');
select public.rw_add_fk_if_possible('notes', 'notes_experience_id_fkey', 'experience_id', 'public', 'experiences', 'id', 'set null');
select public.rw_add_fk_if_possible('notes', 'notes_portfolio_item_id_fkey', 'portfolio_item_id', 'public', 'portfolio_items', 'id', 'set null');
select public.rw_add_fk_if_possible('todos', 'todos_user_id_fkey', 'user_id', 'auth', 'users', 'id', 'cascade');
select public.rw_add_fk_if_possible('todos', 'todos_project_id_fkey', 'project_id', 'public', 'projects', 'id', 'set null');
select public.rw_add_fk_if_possible('todos', 'todos_paper_id_fkey', 'paper_id', 'public', 'papers', 'id', 'set null');
select public.rw_add_fk_if_possible('todos', 'todos_paper_figure_id_fkey', 'paper_figure_id', 'public', 'paper_figures', 'id', 'set null');
select public.rw_add_fk_if_possible('todos', 'todos_experience_id_fkey', 'experience_id', 'public', 'experiences', 'id', 'set null');
select public.rw_add_fk_if_possible('todos', 'todos_portfolio_item_id_fkey', 'portfolio_item_id', 'public', 'portfolio_items', 'id', 'set null');

select public.rw_create_source_index_if_safe('projects', 'projects_user_source_key_idx');
select public.rw_create_source_index_if_safe('papers', 'papers_user_source_key_idx');
select public.rw_create_source_index_if_safe('paper_figures', 'paper_figures_user_source_key_idx');
select public.rw_create_source_index_if_safe('experiences', 'experiences_user_source_key_idx');
select public.rw_create_source_index_if_safe('portfolio_items', 'portfolio_items_user_source_key_idx');
select public.rw_create_source_index_if_safe('notes', 'notes_user_source_key_idx');
select public.rw_create_source_index_if_safe('todos', 'todos_user_source_key_idx');

create index if not exists projects_user_status_idx on public.projects(user_id, status);
create index if not exists papers_user_status_idx on public.papers(user_id, status);
create index if not exists papers_project_idx on public.papers(project_id);
create index if not exists paper_figures_user_status_idx on public.paper_figures(user_id, status);
create index if not exists paper_figures_project_idx on public.paper_figures(project_id);
create index if not exists experiences_user_visibility_idx on public.experiences(user_id, visibility);
create index if not exists experiences_project_idx on public.experiences(project_id);
create index if not exists portfolio_items_user_visibility_idx on public.portfolio_items(user_id, visibility);
create index if not exists portfolio_items_project_idx on public.portfolio_items(project_id);
create index if not exists notes_user_type_idx on public.notes(user_id, note_type);
create index if not exists notes_project_idx on public.notes(project_id);
create index if not exists notes_paper_idx on public.notes(paper_id);
create index if not exists todos_user_status_idx on public.todos(user_id, status);
create index if not exists todos_user_due_on_idx on public.todos(user_id, due_on);
create index if not exists todos_project_idx on public.todos(project_id);
create index if not exists todos_paper_idx on public.todos(paper_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'papers',
    'paper_figures',
    'experiences',
    'portfolio_items',
    'notes',
    'todos'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'projects',
    'papers',
    'paper_figures',
    'experiences',
    'portfolio_items',
    'notes',
    'todos'
  ]
  loop
    policy_name := 'Users manage own ' || table_name;
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.uid() is not null and auth.uid()::text = user_id::text) with check (auth.uid() is not null and auth.uid()::text = user_id::text)',
        policy_name,
        table_name
      );
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portfolio_items'
      and policyname = 'Public portfolio items are readable'
  ) then
    create policy "Public portfolio items are readable"
    on public.portfolio_items
    for select
    using (visibility = 'public' and (published_at is null or published_at <= now()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notes'
      and policyname = 'Public notes are readable'
  ) then
    create policy "Public notes are readable"
    on public.notes
    for select
    using (visibility = 'public');
  end if;
end;
$$;

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'projects',
    'papers',
    'paper_figures',
    'experiences',
    'portfolio_items',
    'notes',
    'todos'
  ]
  loop
    trigger_name := table_name || '_set_updated_at';
    if not exists (
      select 1
      from pg_trigger
      where tgname = trigger_name
        and tgrelid = format('public.%I', table_name)::regclass
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        trigger_name,
        table_name
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'papers',
    'paper_figures',
    'experiences',
    'portfolio_items',
    'notes',
    'todos'
  ]
  loop
    trigger_name := table_name || '_assert_workspace_links';
    if not exists (
      select 1
      from pg_trigger
      where tgname = trigger_name
        and tgrelid = format('public.%I', table_name)::regclass
    ) then
      execute format(
        'create trigger %I before insert or update on public.%I for each row execute function public.assert_workspace_links_match_user()',
        trigger_name,
        table_name
      );
    end if;
  end loop;
end;
$$;
