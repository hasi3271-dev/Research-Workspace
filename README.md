# Research Workspace

AI-assisted productivity workspace for researchers.

## Problem
Research tasks, paper progress, notes, career experiences and job-search materials are often fragmented across multiple tools.

## Solution
Research Workspace connects these workflows in one place:

- Dashboard
- Projects
- Papers
- Research Notes
- STAR Experiences
- Job Tracker
- Calendar
- AI Assistant
- Public/Private data separation

## Tech Stack
- Next.js
- React
- Supabase
- PostgreSQL
- Row Level Security
- Vercel

## Privacy Architecture
This public repository contains only source code and demo data.

Real personal schedules, research details and career documents are stored separately in a private authenticated application and Supabase database.

## Portfolio Value
This project demonstrates:
- problem definition from a real research workflow
- UI/UX design
- frontend implementation
- database architecture
- authentication and data isolation
- deployment strategy
- AI workflow planning

## Development Journey

### Legacy LocalStorage to Supabase Migration
Earlier versions of the planner, portfolio dashboard and research-note workspace stored data in browser `localStorage`. Copying long JSON values directly from DevTools was unreliable because strings could be truncated at around 4096 characters. The migration workflow was changed to export the actual `localStorage` values with JavaScript, validate them with `JSON.parse` and download complete JSON files before import.

### JSON Validation
The importer validates every selected JSON file with `JSON.parse` before mapping. This prevents corrupted or truncated files from reaching the database.

### Import Preview System
An import preview runs before any commit to Supabase. It displays counts for Todos, Portfolio Items, Papers, Figures, Tasks, Notes, Projects and Experiences so the user can review the mapped data before importing.

### Supabase Authentication
The Supabase client configuration was corrected to use `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Imports now run through an authenticated flow instead of anonymous database writes, and Row Level Security keeps imported records scoped to the current user.

### Legacy Data Mapping
The legacy apps used different JSON structures for planner, portfolio and research-note data. The importer was expanded to support those formats, preserve Korean priority labels while mapping numeric priority values and keep `source_file`, `source_key` and `raw_data` for auditing or later deduplication.

### Relationship Mapping
The migration preserves relationships between papers, paper figures and paper tasks. Figure labels and source metadata are used to keep related records connected during import.

### Import Validation
Schema issues are handled in the mapping layer when possible. For example, an existing `todos.todo_date` `NOT NULL` constraint was satisfied by mapping planner `due` values into `todo_date` and using a safe default date for missing values instead of weakening the database constraint.

### Migration Strategy
Compatibility migrations are written to be idempotent and non-destructive. They use patterns such as `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, conditional policy and trigger creation and non-validating foreign keys where appropriate, preserving existing rows while upgrading older Supabase projects.

### Lessons Learned
- Browser storage exports should be automated and validated, not copied by hand.
- Raw legacy records should be preserved alongside normalized database fields.
- Preview counts make imports safer and easier to review.
- Authentication and RLS should be part of the import path.
- Reproducible migrations are safer than one-off manual database fixes.

## Run
```bash
npm install
npm run dev
```

## Roadmap
- v1.0 Core workspace structure
- v1.1 Supabase-backed private app
- v1.2 AI paper summarization
- v1.3 STAR-to-cover-letter workflow
- v1.4 research writing assistant
