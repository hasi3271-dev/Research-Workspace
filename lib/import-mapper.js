const ENTITY_KEYS = [
  "projects",
  "papers",
  "paperFigures",
  "portfolioItems",
  "todos",
  "notes",
  "experiences"
];

const SOURCE_NAMES = {
  planner: "planner",
  portfolio: "portfolio",
  researchNote: "research-note"
};

export function buildImportPreview(files) {
  const plan = createPlan();

  for (const file of files) {
    const source = sourceFromFileName(file.name);

    if (source === SOURCE_NAMES.planner) {
      mapPlanner(file.data, file.name, plan);
    } else if (source === SOURCE_NAMES.portfolio) {
      mapPortfolio(file.data, file.name, plan);
    } else if (source === SOURCE_NAMES.researchNote) {
      mapResearchNotes(file.data, file.name, plan);
    } else {
      plan.warnings.push(`${file.name} was skipped because it is not one of the supported import files.`);
    }
  }

  return {
    entities: plan.entities,
    counts: {
      todos: plan.entities.todos.length,
      portfolioItems: plan.entities.portfolioItems.length,
      papers: plan.entities.papers.length,
      figures: plan.entities.paperFigures.length,
      tasks: plan.taskCount,
      notes: plan.entities.notes.length,
      projects: plan.entities.projects.length,
      experiences: plan.entities.experiences.length
    },
    warnings: plan.warnings
  };
}

export function sourceFromFileName(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.endsWith("planner.json") || normalized.includes("planner")) return SOURCE_NAMES.planner;
  if (normalized.endsWith("portfolio.json") || normalized.includes("portfolio")) return SOURCE_NAMES.portfolio;
  if (normalized.endsWith("research-note.json") || normalized.includes("research-note")) return SOURCE_NAMES.researchNote;
  return null;
}

export function stableHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createPlan() {
  return {
    entities: ENTITY_KEYS.reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
    seen: new Set(),
    warnings: [],
    taskCount: 0
  };
}

function mapPlanner(data, sourceFile, plan) {
  const items = extractPlannerItems(data);

  items.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const originalId = pickFirst(item, ["id", "uid", "uuid", "key", "taskId", "todoId"]);
    const title = stringifyValue(pickFirst(item, ["title", "name", "task", "text", "content"]));

    if (!title) {
      plan.warnings.push(`${sourceFile}: planner item ${index + 1} was skipped because it has no title.`);
      return;
    }

    const done = toBoolean(pickFirst(item, ["done", "completed", "isDone", "checked"])) || normalizeStatus(item.status) === "done";
    const priority = normalizePriority(pickFirst(item, ["priority", "importance", "rank"]));
    const sourceKey = makeSourceKey("planner", "todo", originalId, item, [index]);

    addEntity(plan, "todos", sourceKey, {
      row: {
        title,
        description: stringifyValue(pickFirst(item, ["description", "body", "memo", "note"])),
        status: done ? "done" : normalizeTodoStatus(item.status),
        priority,
        due_on: normalizeDate(pickFirst(item, ["dueDate", "due_date", "due", "date", "deadline"])),
        source_file: sourceFile,
        source_key: sourceKey,
        raw_data: item,
        metadata: compactObject({
          import_source: "planner",
          original_id: originalId,
          category: pickFirst(item, ["category", "group", "type", "tag"]),
          original_priority: pickFirst(item, ["priority", "importance", "rank"]),
          original_done: pickFirst(item, ["done", "completed", "isDone", "checked"])
        })
      }
    });
  });
}

function mapPortfolio(data, sourceFile, plan) {
  const rootHash = stableHash(data);
  const placeholderPaperKey = makeSourceKey("portfolio", "paper", `orphan-figures-${rootHash}`, data, []);

  walkPortfolio(data, [], {
    year: null,
    projectKey: null,
    paperKey: null,
    figureKey: null,
    sourceFile,
    placeholderPaperKey
  }, plan);
}

function walkPortfolio(node, path, context, plan) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkPortfolio(item, [...path, String(index)], context, plan));
    return;
  }

  if (!isPlainObject(node)) return;

  const key = path[path.length - 1] || "";
  const year = normalizeYear(node.year) || normalizeYear(key) || context.year;
  let nextContext = { ...context, year };

  if (looksLikeProject(node, path)) {
    nextContext.projectKey = addProjectFromObject(node, path, context.sourceFile, year, plan);
  } else {
    const projectValue = pickFirst(node, ["project", "projectName", "project_name"]);
    if (projectValue) {
      nextContext.projectKey = addProjectFromValue(projectValue, path, context.sourceFile, year, plan);
    }
  }

  if (looksLikePaper(node, path)) {
    nextContext.paperKey = addPaperFromObject(node, path, nextContext, plan);
  }

  if (looksLikeFigure(node, path)) {
    const paperKey = nextContext.paperKey || context.paperKey || context.placeholderPaperKey;
    if (!nextContext.paperKey && !context.paperKey) {
      addPlaceholderPaper(context.placeholderPaperKey, context.sourceFile, plan);
    }
    nextContext.figureKey = addFigureFromObject(node, path, { ...nextContext, paperKey }, plan);
  }

  if (looksLikePortfolioItem(node, path, nextContext)) {
    nextContext.portfolioItemKey = addPortfolioItemFromObject(node, path, nextContext, plan);
  }

  if (looksLikeExperience(node, path)) {
    nextContext.experienceKey = addExperienceFromObject(node, path, nextContext, plan);
  }

  for (const [childKey, value] of Object.entries(node)) {
    const childPath = [...path, childKey];
    if (isTaskCollection(childKey, value)) {
      asArray(value).forEach((task, index) => {
        addTaskFromObject(task, [...childPath, String(index)], nextContext, plan);
      });
    } else if (isNoteCollection(childKey, value)) {
      asArray(value).forEach((note, index) => {
        addNoteFromObject(note, [...childPath, String(index)], nextContext, plan, "portfolio");
      });
    } else {
      walkPortfolio(value, childPath, nextContext, plan);
    }
  }
}

function mapResearchNotes(data, sourceFile, plan) {
  const notes = extractNotes(data);

  notes.forEach((note, index) => {
    addNoteFromObject(note, [String(index)], { sourceFile }, plan, "research-note");
  });
}

function addProjectFromValue(value, path, sourceFile, year, plan) {
  const raw = isPlainObject(value) ? value : { title: String(value) };
  return addProjectFromObject(raw, [...path, "project"], sourceFile, year, plan);
}

function addProjectFromObject(project, path, sourceFile, year, plan) {
  const title = stringifyValue(pickFirst(project, ["title", "name", "project", "projectName", "project_name"]));
  if (!title) return null;

  const sourceKey = makeSourceKey("portfolio", "project", pickFirst(project, ["id", "slug", "key"]), project, path);
  addEntity(plan, "projects", sourceKey, {
    row: {
      title,
      slug: slugify(pickFirst(project, ["slug", "key"]) || title),
      summary: stringifyValue(pickFirst(project, ["summary", "description", "body"])),
      status: normalizeProjectStatus(project.status),
      progress: normalizeProgress(project.progress),
      next_action: stringifyValue(pickFirst(project, ["next", "nextAction", "next_action"])),
      source_file: sourceFile,
      source_key: sourceKey,
      raw_data: project,
      metadata: compactObject({
        import_source: "portfolio",
        year,
        role: project.role,
        skills: project.skills || project.skill,
        category: project.category,
        original_id: pickFirst(project, ["id", "slug", "key"])
      })
    }
  });

  return sourceKey;
}

function addPaperFromObject(paper, path, context, plan) {
  const title = stringifyValue(pickFirst(paper, ["title", "name", "paper", "manuscript"]));
  if (!title) return null;

  const sourceKey = makeSourceKey("portfolio", "paper", pickFirst(paper, ["id", "doi", "citationKey", "citation_key", "key"]), paper, path);
  addEntity(plan, "papers", sourceKey, {
    projectSourceKey: context.projectKey,
    row: {
      title,
      citation_key: stringifyValue(pickFirst(paper, ["citationKey", "citation_key", "key"])),
      authors: normalizeTextArray(paper.authors || paper.author),
      journal: stringifyValue(paper.journal || paper.venue),
      publication_year: normalizeYear(paper.year || paper.publicationYear || paper.publication_year),
      doi: stringifyValue(paper.doi),
      url: stringifyValue(paper.url || paper.link),
      abstract: stringifyValue(paper.abstract || paper.summary),
      status: normalizePaperStatus(paper.status),
      progress: normalizeProgress(pickFirst(paper, ["progress", "completion"])),
      deadline_on: normalizeDate(pickFirst(paper, ["deadline", "deadline_on", "due", "dueDate"])),
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: paper,
      metadata: compactObject({
        import_source: "portfolio",
        year: context.year,
        project: pickFirst(paper, ["project", "projectName", "project_name"]),
        role: paper.role,
        skills: paper.skills || paper.skill,
        original_id: pickFirst(paper, ["id", "doi", "citationKey", "citation_key", "key"])
      })
    }
  });

  return sourceKey;
}

function addPlaceholderPaper(sourceKey, sourceFile, plan) {
  addEntity(plan, "papers", sourceKey, {
    row: {
      title: "Imported portfolio figures",
      status: "analysis",
      source_file: sourceFile,
      source_key: sourceKey,
      raw_data: {},
      metadata: {
        import_source: "portfolio",
        generated_for: "orphan_figures"
      }
    }
  });
}

function addFigureFromObject(figure, path, context, plan) {
  const label = stringifyValue(pickFirst(figure, ["label", "figureLabel", "figure_label", "number"]));
  const title = stringifyValue(pickFirst(figure, ["title", "name", "claim"])) || label || "Imported figure";
  const sourceKey = makeSourceKey("portfolio", "figure", pickFirst(figure, ["id", "key", "label", "figureLabel", "figure_label"]), figure, path);

  addEntity(plan, "paperFigures", sourceKey, {
    projectSourceKey: context.projectKey,
    paperSourceKey: context.paperKey,
    row: {
      figure_label: label,
      title,
      caption: stringifyValue(figure.caption),
      asset_url: stringifyValue(pickFirst(figure, ["assetUrl", "asset_url", "image", "imageUrl", "image_url"])),
      figure_type: normalizeFigureType(figure.type),
      status: normalizeFigureStatus(figure.status),
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: figure,
      metadata: compactObject({
        import_source: "portfolio",
        year: context.year,
        claim: figure.claim,
        data: figure.data,
        next: figure.next || figure.nextAction || figure.next_action,
        reference: figure.reference || figure.ref,
        original_id: pickFirst(figure, ["id", "key", "label", "figureLabel", "figure_label"])
      })
    }
  });

  return sourceKey;
}

function addPortfolioItemFromObject(item, path, context, plan) {
  const title = stringifyValue(pickFirst(item, ["title", "name", "project", "role"]));
  if (!title) return null;

  const sourceKey = makeSourceKey("portfolio", "item", pickFirst(item, ["id", "slug", "key"]), item, path);
  addEntity(plan, "portfolioItems", sourceKey, {
    projectSourceKey: context.projectKey,
    paperSourceKey: context.paperKey,
    experienceSourceKey: context.experienceKey,
    row: {
      title,
      summary: stringifyValue(pickFirst(item, ["summary", "description", "subtitle"])),
      body: stringifyValue(pickFirst(item, ["body", "content", "detail", "details"])),
      item_type: normalizePortfolioType(item.type),
      visibility: item.public === true ? "public" : "private",
      featured: Boolean(item.featured),
      asset_url: stringifyValue(pickFirst(item, ["assetUrl", "asset_url", "image", "imageUrl", "image_url"])),
      external_url: stringifyValue(pickFirst(item, ["externalUrl", "external_url", "url", "link"])),
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: item,
      metadata: compactObject({
        import_source: "portfolio",
        year: context.year,
        role: item.role,
        skills: item.skills || item.skill,
        project: pickFirst(item, ["project", "projectName", "project_name"]),
        original_id: pickFirst(item, ["id", "slug", "key"])
      })
    }
  });

  return sourceKey;
}

function addExperienceFromObject(experience, path, context, plan) {
  const title = stringifyValue(pickFirst(experience, ["title", "name", "role", "experience"]));
  if (!title) return null;

  const sourceKey = makeSourceKey("portfolio", "experience", pickFirst(experience, ["id", "slug", "key"]), experience, path);
  addEntity(plan, "experiences", sourceKey, {
    projectSourceKey: context.projectKey,
    row: {
      title,
      category: stringifyValue(experience.category || experience.type),
      role: stringifyValue(experience.role),
      organization: stringifyValue(experience.organization || experience.company),
      situation: stringifyValue(experience.situation || experience.S),
      task: stringifyValue(experience.task || experience.T),
      action: stringifyValue(experience.action || experience.A),
      result: stringifyValue(experience.result || experience.R),
      reflection: stringifyValue(experience.reflection),
      tags: normalizeTextArray(experience.tags || experience.skills || experience.skill),
      occurred_on: normalizeDate(experience.date || experience.occurred_on),
      visibility: experience.public === true ? "public" : "private",
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: experience,
      metadata: compactObject({
        import_source: "portfolio",
        year: context.year,
        original_id: pickFirst(experience, ["id", "slug", "key"])
      })
    }
  });

  return sourceKey;
}

function addTaskFromObject(task, path, context, plan) {
  if (!isPlainObject(task)) return null;
  const title = stringifyValue(pickFirst(task, ["title", "name", "task", "text", "content", "next"]));
  if (!title) return null;

  const done = toBoolean(pickFirst(task, ["done", "completed", "isDone", "checked"])) || normalizeStatus(task.status) === "done";
  const sourceKey = makeSourceKey("portfolio", "task", pickFirst(task, ["id", "key", "taskId", "todoId"]), task, path);

  addEntity(plan, "todos", sourceKey, {
    projectSourceKey: context.projectKey,
    paperSourceKey: context.paperKey,
    paperFigureSourceKey: context.figureKey,
    portfolioItemSourceKey: context.portfolioItemKey,
    row: {
      title,
      description: stringifyValue(task.description || task.body || task.note),
      status: done ? "done" : normalizeTodoStatus(task.status),
      priority: normalizePriority(task.priority),
      due_on: normalizeDate(task.due || task.dueDate || task.deadline || task.date),
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: task,
      metadata: compactObject({
        import_source: "portfolio",
        task_scope: context.figureKey ? "figure" : context.paperKey ? "paper" : "portfolio",
        category: task.category || task.group || task.type,
        original_id: pickFirst(task, ["id", "key", "taskId", "todoId"])
      })
    }
  });

  plan.taskCount += 1;
  return sourceKey;
}

function addNoteFromObject(note, path, context, plan, importSource) {
  const raw = isPlainObject(note) ? note : { body: String(note) };
  const title = stringifyValue(pickFirst(raw, ["title", "name", "heading"]));
  const body = stringifyValue(pickFirst(raw, ["body", "content", "text", "note", "memo", "summary"])) || title;
  if (!body) return null;

  const sourceKey = makeSourceKey(importSource, "note", pickFirst(raw, ["id", "key", "slug"]), raw, path);
  addEntity(plan, "notes", sourceKey, {
    projectSourceKey: context.projectKey,
    paperSourceKey: context.paperKey,
    paperFigureSourceKey: context.figureKey,
    portfolioItemSourceKey: context.portfolioItemKey,
    row: {
      title,
      body,
      note_type: normalizeNoteType(raw.type || raw.category || importSource),
      tags: normalizeTextArray(raw.tags || raw.tag),
      is_pinned: Boolean(raw.pinned || raw.isPinned),
      visibility: raw.public === true ? "public" : "private",
      source_file: context.sourceFile,
      source_key: sourceKey,
      raw_data: raw,
      metadata: compactObject({
        import_source: importSource,
        original_id: pickFirst(raw, ["id", "key", "slug"]),
        category: raw.category,
        year: context.year
      })
    }
  });

  return sourceKey;
}

function addEntity(plan, entityKey, sourceKey, entity) {
  const seenKey = `${entityKey}:${sourceKey}`;
  if (plan.seen.has(seenKey)) {
    plan.warnings.push(`Duplicate ${entityKey} source key skipped in preview: ${sourceKey}`);
    return false;
  }
  plan.seen.add(seenKey);
  plan.entities[entityKey].push({ ...entity, sourceKey });
  return true;
}

function extractPlannerItems(data) {
  if (Array.isArray(data)) return data;
  if (!isPlainObject(data)) return [];

  for (const key of ["items", "tasks", "todos", "planner", "events"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  const arrays = [];
  collectArrays(data, [], arrays, key => /^(items|tasks|todos|planner|events)$/i.test(key));
  return arrays.flat();
}

function extractNotes(data) {
  if (Array.isArray(data)) return data;
  if (!isPlainObject(data)) return [];

  for (const key of ["notes", "items", "researchNotes", "research_notes"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  const arrays = [];
  collectArrays(data, [], arrays, key => /notes?$/i.test(key));
  return arrays.length ? arrays.flat() : [data];
}

function collectArrays(node, path, arrays, keyPredicate) {
  if (!isPlainObject(node) && !Array.isArray(node)) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectArrays(item, [...path, String(index)], arrays, keyPredicate));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) && keyPredicate(key)) arrays.push(value);
    collectArrays(value, [...path, key], arrays, keyPredicate);
  }
}

function looksLikeProject(obj, path) {
  const key = path[path.length - 1] || "";
  return /projects?/i.test(key) && Boolean(pickFirst(obj, ["title", "name", "project", "projectName", "project_name"]));
}

function looksLikePaper(obj, path) {
  const key = path[path.length - 1] || "";
  const parentKey = path[path.length - 2] || "";
  return Boolean(
    pickFirst(obj, ["title", "name", "paper", "manuscript"]) &&
    (/papers?|publications?|manuscripts?/i.test(key) ||
      /papers?|publications?|manuscripts?/i.test(parentKey) ||
      obj.doi || obj.journal || obj.venue || obj.authors || obj.figures)
  );
}

function looksLikeFigure(obj, path) {
  const key = path[path.length - 1] || "";
  return Boolean(
    (/figures?|tables?|schemes?/i.test(key) ||
      obj.figureLabel || obj.figure_label || obj.label || obj.claim || obj.caption || obj.reference) &&
    !looksLikePaper(obj, path)
  );
}

function looksLikePortfolioItem(obj, path, context) {
  const pathText = path.join(".");
  return Boolean(
    pickFirst(obj, ["title", "name", "project", "role"]) &&
    (context.year || /portfolio|items?|showcase|years?/i.test(pathText)) &&
    !looksLikePaper(obj, path) &&
    !looksLikeFigure(obj, path)
  );
}

function looksLikeExperience(obj, path) {
  const key = path[path.length - 1] || "";
  return Boolean(
    /experiences?|roles?/i.test(key) &&
    pickFirst(obj, ["title", "name", "role", "experience"])
  );
}

function isTaskCollection(key, value) {
  return Array.isArray(value) && /^(tasks|todos|paperTasks|paper_tasks|nextActions|next_actions)$/i.test(key);
}

function isNoteCollection(key, value) {
  return Array.isArray(value) && /^(notes|researchNotes|research_notes)$/i.test(key);
}

function sourceKeyPrefix(source, type) {
  return `${source}:${type}`;
}

function makeSourceKey(source, type, idCandidate, fallback, path) {
  const id = stringifyValue(idCandidate);
  const pathPart = path.length ? path.join(".") : "root";
  const suffix = id ? slugify(id) : `${slugify(pathPart)}-${stableHash(fallback)}`;
  return `${sourceKeyPrefix(source, type)}:${suffix}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return null;
}

function stringifyValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function normalizeDate(value) {
  const text = stringifyValue(value);
  if (!text || /^tbd$/i.test(text)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeYear(value) {
  const text = stringifyValue(value);
  if (!text) return null;
  const match = text.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function normalizeProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") return 3;
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(1, Math.min(5, Math.round(number)));
  const text = String(value).toLowerCase();
  if (["urgent", "highest", "high"].includes(text)) return 1;
  if (["medium", "normal"].includes(text)) return 3;
  if (["low", "lowest"].includes(text)) return 5;
  return 3;
}

function normalizeStatus(value) {
  return stringifyValue(value)?.toLowerCase().replace(/\s+/g, "_") || null;
}

function normalizeTodoStatus(value) {
  const status = normalizeStatus(value);
  if (["in_progress", "doing"].includes(status)) return "in_progress";
  if (["blocked", "waiting"].includes(status)) return "blocked";
  if (["done", "complete", "completed", "finished"].includes(status)) return "done";
  if (["canceled", "cancelled"].includes(status)) return "canceled";
  return "open";
}

function normalizeProjectStatus(value) {
  const status = normalizeStatus(value);
  if (["active", "paused", "completed", "archived"].includes(status)) return status;
  return "planning";
}

function normalizePaperStatus(value) {
  const status = normalizeStatus(value);
  if (["to_read", "reading", "reviewed", "analysis", "drafting", "manuscript", "submitted", "published", "archived"].includes(status)) {
    return status;
  }
  if (status === "draft") return "drafting";
  return "reading";
}

function normalizeFigureStatus(value) {
  const status = normalizeStatus(value);
  if (["draft", "needs_revision", "ready", "submitted", "archived"].includes(status)) return status;
  if (status === "todo" || status === "open") return "draft";
  return "draft";
}

function normalizeFigureType(value) {
  const type = normalizeStatus(value);
  if (["figure", "table", "scheme", "graph", "image", "supporting"].includes(type)) return type;
  return "figure";
}

function normalizeNoteType(value) {
  const type = normalizeStatus(value);
  if (["research", "paper", "figure", "career", "meeting", "idea", "portfolio"].includes(type)) return type;
  if (type === "research-note") return "research";
  return "research";
}

function normalizePortfolioType(value) {
  const type = normalizeStatus(value);
  if (["case_study", "project", "paper", "figure", "experience", "note", "link"].includes(type)) return type;
  return "case_study";
}

function normalizeTextArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean);
  const text = stringifyValue(value);
  if (!text) return [];
  return text.split(",").map(item => item.trim()).filter(Boolean);
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "yes", "y", "done", "completed", "1"].includes(value.toLowerCase());
  return false;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
