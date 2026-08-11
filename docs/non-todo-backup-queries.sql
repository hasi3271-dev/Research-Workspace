-- Non-Todo backup and restore helper queries.
-- These queries are intentionally scoped away from public.todos.
-- Run them in the Supabase SQL Editor while signed in as the target user.

-- 1. Count preserved non-Todo rows for the current authenticated user.
select 'projects' as table_name, count(*) as row_count
from public.projects
where user_id = auth.uid()
union all
select 'papers', count(*)
from public.papers
where user_id = auth.uid()
union all
select 'paper_figures', count(*)
from public.paper_figures
where user_id = auth.uid()
union all
select 'notes', count(*)
from public.notes
where user_id = auth.uid()
union all
select 'experiences', count(*)
from public.experiences
where user_id = auth.uid()
union all
select 'portfolio_items', count(*)
from public.portfolio_items
where user_id = auth.uid();

-- 2. Export non-Todo rows as one JSON document.
-- Supabase can download the query result as CSV/JSON from the SQL Editor.
select jsonb_build_object(
  'projects', coalesce((select jsonb_agg(to_jsonb(t)) from public.projects t where t.user_id = auth.uid()), '[]'::jsonb),
  'papers', coalesce((select jsonb_agg(to_jsonb(t)) from public.papers t where t.user_id = auth.uid()), '[]'::jsonb),
  'paper_figures', coalesce((select jsonb_agg(to_jsonb(t)) from public.paper_figures t where t.user_id = auth.uid()), '[]'::jsonb),
  'notes', coalesce((select jsonb_agg(to_jsonb(t)) from public.notes t where t.user_id = auth.uid()), '[]'::jsonb),
  'experiences', coalesce((select jsonb_agg(to_jsonb(t)) from public.experiences t where t.user_id = auth.uid()), '[]'::jsonb),
  'portfolio_items', coalesce((select jsonb_agg(to_jsonb(t)) from public.portfolio_items t where t.user_id = auth.uid()), '[]'::jsonb)
) as non_todo_backup;

-- 3. Restore one preserved non-Todo record into the primary UI.
-- Replace the table name and id, then run only for the record you want to restore.
/*
update public.projects
set metadata = coalesce(metadata, '{}'::jsonb) || '{"workspace_active": true}'::jsonb
where user_id = auth.uid()
  and id = '<project-id>';
*/
