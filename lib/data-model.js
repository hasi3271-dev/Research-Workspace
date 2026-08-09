export const TABLES = Object.freeze({
  projects: "projects",
  papers: "papers",
  paperFigures: "paper_figures",
  todos: "todos",
  notes: "notes",
  experiences: "experiences",
  portfolioItems: "portfolio_items"
});

export const PROJECT_STATUS = Object.freeze([
  "planning",
  "active",
  "paused",
  "completed",
  "archived"
]);

export const PAPER_STATUS = Object.freeze([
  "to_read",
  "reading",
  "reviewed",
  "analysis",
  "drafting",
  "manuscript",
  "submitted",
  "published",
  "archived"
]);

export const PAPER_FIGURE_STATUS = Object.freeze([
  "draft",
  "needs_revision",
  "ready",
  "submitted",
  "archived"
]);

export const TODO_STATUS = Object.freeze([
  "open",
  "in_progress",
  "blocked",
  "done",
  "canceled"
]);

export const NOTE_TYPE = Object.freeze([
  "research",
  "paper",
  "figure",
  "career",
  "meeting",
  "idea",
  "portfolio"
]);

export const PORTFOLIO_ITEM_TYPE = Object.freeze([
  "case_study",
  "project",
  "paper",
  "figure",
  "experience",
  "note",
  "link"
]);

export const VISIBILITY = Object.freeze({
  private: "private",
  public: "public",
  portfolio: "portfolio"
});

export const ENTITY_RELATIONSHIPS = Object.freeze({
  projects: ["papers", "paperFigures", "todos", "notes", "experiences", "portfolioItems"],
  papers: ["project", "paperFigures", "todos", "notes", "portfolioItems"],
  paperFigures: ["paper", "project", "todos", "notes"],
  todos: ["project", "paper", "paperFigure", "experience", "portfolioItem"],
  notes: ["project", "paper", "paperFigure", "experience", "portfolioItem"],
  experiences: ["project", "todos", "notes", "portfolioItems"],
  portfolioItems: ["project", "paper", "experience", "todos", "notes"]
});

export const DEFAULT_SELECTS = Object.freeze({
  projects: `
    id,user_id,title,slug,summary,status,progress,started_on,target_on,
    completed_on,next_action,is_archived,source_file,source_key,raw_data,
    metadata,created_at,updated_at
  `,
  papers: `
    id,user_id,project_id,title,citation_key,authors,journal,publication_year,
    doi,url,abstract,status,progress,deadline_on,published_on,metadata,
    source_file,source_key,raw_data,created_at,updated_at
  `,
  paperFigures: `
    id,user_id,paper_id,project_id,figure_label,title,caption,asset_url,
    source_page,figure_type,status,sort_order,source_file,source_key,raw_data,
    metadata,created_at,updated_at
  `,
  todos: `
    id,user_id,project_id,paper_id,paper_figure_id,experience_id,
    portfolio_item_id,title,description,status,priority,due_on,completed_at,
    sort_order,source_file,source_key,raw_data,metadata,created_at,updated_at
  `,
  notes: `
    id,user_id,project_id,paper_id,paper_figure_id,experience_id,
    portfolio_item_id,title,body,note_type,tags,is_pinned,visibility,
    source_file,source_key,raw_data,metadata,created_at,updated_at
  `,
  experiences: `
    id,user_id,project_id,title,category,role,organization,situation,task,
    action,result,reflection,tags,occurred_on,visibility,metadata,
    source_file,source_key,raw_data,created_at,updated_at
  `,
  portfolioItems: `
    id,user_id,project_id,paper_id,experience_id,title,summary,body,
    item_type,visibility,featured,sort_order,asset_url,external_url,
    published_at,source_file,source_key,raw_data,metadata,created_at,updated_at
  `
});

export const researchWorkspaceModel = Object.freeze({
  tables: TABLES,
  relationships: ENTITY_RELATIONSHIPS,
  selects: DEFAULT_SELECTS
});
