# Non-Todo Workspace Reset Plan

This document records the safe reset strategy for Research Workspace.

## Goal

Keep all existing Supabase data, preserve the full Todo system, and make non-Todo sections feel like clean spaces that can be rewritten from scratch.

## Preserved Data

The app does not delete, truncate, or re-import data as part of this reset.

Todos remain fully active:
- `todos`
- Todo date grouping
- Todo add, edit, delete, completion, filters, search
- Todo `user_id`, RLS, `source_file`, `source_key`, and `raw_data`

Non-Todo legacy/imported rows are preserved in Supabase:
- `projects`
- `papers`
- `paper_figures`
- `notes`
- `experiences`
- `portfolio_items`

## Active Workspace Rule

For non-Todo tables, the primary UI shows only records that are intentionally created or marked active in the new workspace:

```text
source_file = 'ui'
or metadata.workspace_active = true
```

Legacy rows remain queryable in Supabase and are counted in Settings as preserved legacy data.

## Restore Strategy

To restore a preserved non-Todo record into the primary UI, mark it active without changing Todo data:

```sql
update public.projects
set metadata = coalesce(metadata, '{}'::jsonb) || '{"workspace_active": true}'::jsonb
where user_id = auth.uid()
  and id = '<project-id>';
```

Use the same pattern for `papers`, `paper_figures`, `notes`, `experiences`, or `portfolio_items`.

Do not run this against `todos`.

## Backup Guidance

Before any destructive cleanup is considered, export each non-Todo table from Supabase or create SQL backups that include:
- `id`
- `user_id`
- relationship columns
- `source_file`
- `source_key`
- `raw_data`
- `metadata`
- `created_at`
- `updated_at`

Helper queries are available in `docs/non-todo-backup-queries.sql`.

No destructive cleanup was performed for this reset.
