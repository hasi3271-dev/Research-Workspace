"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ImportExistingData from "./import-existing-data";
import { DEFAULT_SELECTS, TABLES } from "../lib/data-model";
import { supabase } from "../lib/supabase";
import { groupTodosByDate } from "../lib/todo-order";

const tabs = [
  ["dashboard", "Dashboard"],
  ["todos", "Todos"],
  ["projects", "Projects"],
  ["papers", "Papers"],
  ["notes", "Research Notes"],
  ["star", "STAR Experiences"],
  ["portfolio", "Portfolio"],
  ["jobs", "Job Tracker"],
  ["calendar", "Calendar"],
  ["ai", "AI Assistant"],
  ["settings", "Settings"]
];

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todoFilters = ["all", "open", "completed"];
const projectStatusGroups = [
  ["Active", ["active", "planning"]],
  ["On Hold", ["paused", "blocked"]],
  ["Completed", ["completed"]],
  ["Archived", ["archived"]]
];
const projectAreas = ["All", "Research", "Career", "Development", "Personal"];
const paperStages = ["Idea", "In Progress", "Writing", "Submitted", "Revision", "Accepted", "Published", "Archived"];
const noteTypes = ["All", "meeting", "research", "paper", "idea", "experiment", "feedback", "miscellaneous"];
const portfolioCategories = ["Research Project", "Publication", "Award", "Presentation / Seminar", "Education / Training", "Certification", "Development Project", "Other"];

const emptyWorkspace = {
  todos: [],
  projects: [],
  papers: [],
  paperFigures: [],
  notes: [],
  experiences: [],
  portfolioItems: []
};

const tableLoads = [
  ["projects", TABLES.projects, DEFAULT_SELECTS.projects, [["updated_at", { ascending: false }]]],
  ["papers", TABLES.papers, DEFAULT_SELECTS.papers, [["updated_at", { ascending: false }]]],
  ["paperFigures", TABLES.paperFigures, DEFAULT_SELECTS.paperFigures, [["sort_order", { ascending: true }], ["created_at", { ascending: true }]]],
  ["notes", TABLES.notes, DEFAULT_SELECTS.notes, [["is_pinned", { ascending: false }], ["updated_at", { ascending: false }]]],
  ["experiences", TABLES.experiences, DEFAULT_SELECTS.experiences, [["updated_at", { ascending: false }]]],
  ["portfolioItems", TABLES.portfolioItems, DEFAULT_SELECTS.portfolioItems, [["featured", { ascending: false }], ["sort_order", { ascending: true }], ["updated_at", { ascending: false }]]]
];

export default function Page() {
  const [tab, setTab] = useState("dashboard");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [dataState, setDataState] = useState({ loading: false, error: null, loadedAt: null });
  const [editor, setEditor] = useState(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [saveState, setSaveState] = useState(null);

  const loadWorkspace = useCallback(async userId => {
    if (!supabase || !userId) return;

    setDataState({ loading: true, error: null, loadedAt: null });
    try {
      const nextWorkspace = await fetchWorkspaceData(userId);
      setWorkspace(nextWorkspace);
      setDataState({ loading: false, error: null, loadedAt: new Date() });
    } catch (error) {
      setWorkspace(emptyWorkspace);
      setDataState({ loading: false, error: error.message, loadedAt: null });
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!supabase) {
      setAuthLoading(false);
      setDataState({
        loading: false,
        error: "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        loadedAt: null
      });
      return;
    }

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      setUser(error ? null : data?.user || null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      setWorkspace(emptyWorkspace);
      setDataState(state => ({ ...state, loading: false }));
      return;
    }

    loadWorkspace(user.id);
  }, [authLoading, loadWorkspace, user?.id]);

  const references = useMemo(() => buildReferences(workspace), [workspace]);
  const activeWorkspace = useMemo(() => toActiveWorkspace(workspace), [workspace]);
  const legacyCounts = useMemo(() => buildLegacyCounts(workspace, activeWorkspace), [workspace, activeWorkspace]);
  const activeReferences = useMemo(() => buildReferences(activeWorkspace), [activeWorkspace]);
  const counts = useMemo(() => buildCounts(activeWorkspace), [activeWorkspace]);
  const globalResults = useMemo(() => searchWorkspace(activeWorkspace, globalQuery), [activeWorkspace, globalQuery]);
  const viewState = {
    loading: authLoading || dataState.loading,
    error: dataState.error,
    signedIn: Boolean(user?.id),
    configured: Boolean(supabase),
    loadedAt: dataState.loadedAt
  };

  const openEditor = useCallback((type, record = null, defaults = {}) => {
    setSaveState(null);
    setEditor({ type, record, defaults });
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setSaveState(null);
  }, []);

  const saveRecord = useCallback(async (type, record, values) => {
    if (!supabase || !user?.id) throw new Error("You must be signed in before saving.");

    const { table, row } = buildSavePayload(type, record, values, user.id);
    const query = record?.id
      ? supabase.from(table).update(row).eq("id", record.id).eq("user_id", user.id).select().single()
      : supabase.from(table).insert(row).select().single();

    const { error } = await query;
    if (error) throw error;
    await loadWorkspace(user.id);
  }, [loadWorkspace, user?.id]);

  const deleteRecord = useCallback(async (type, record) => {
    if (!supabase || !user?.id || !record?.id) return;
    if (!window.confirm(`Delete "${displayTitle(record, "this record")}"? This cannot be undone.`)) return;

    setSaveState({ ok: true, message: "Deleting..." });
    const { table } = tableForEditorType(type);
    const { error } = await supabase.from(table).delete().eq("id", record.id).eq("user_id", user.id);
    if (error) {
      setSaveState({ ok: false, message: error.message });
      return;
    }

    setEditor(null);
    await loadWorkspace(user.id);
    setSaveState({ ok: true, message: "Deleted." });
  }, [loadWorkspace, user?.id]);

  const quickUpdate = useCallback(async (type, record, values) => {
    setSaveState(null);
    try {
      await saveRecord(type, record, values);
      setSaveState({ ok: true, message: "Saved." });
    } catch (error) {
      setSaveState({ ok: false, message: error.message });
    }
  }, [saveRecord]);

  return <div className="app">
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">R</div>
        <div>
          <b>Research Workspace</b>
          <span>PRIVATE RESEARCH APP</span>
        </div>
      </div>

      <nav>
        {tabs.map(([key, label]) =>
          <button key={key} className={tab === key ? "nav active" : "nav"} onClick={() => setTab(key)}>{label}</button>
        )}
      </nav>

      <div className="sidebarFooter">
        <div className="privacy">{user?.email || "Not signed in"}</div>
        <div className="tiny">Supabase RLS protects user-owned data.</div>
      </div>
    </aside>

    <main className="main">
      <header>
        <div>
          <h1>{tabs.find(item => item[0] === tab)?.[1]}</h1>
          <p>Research, career, experience and AI workflow</p>
        </div>
        <button className="secondary" onClick={() => user?.id && loadWorkspace(user.id)} disabled={!user?.id || viewState.loading}>
          {viewState.loading ? "Loading..." : "Refresh"}
        </button>
      </header>

      <DataBanner state={viewState} counts={counts} saveState={saveState}/>

      {viewState.signedIn && <GlobalSearch query={globalQuery} setQuery={setGlobalQuery} results={globalResults} setTab={setTab} openEditor={openEditor}/>}

      {tab === "dashboard" && <Dashboard data={activeWorkspace} allCounts={buildCounts(workspace)} counts={counts} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "todos" && <Todos items={workspace.todos} refs={references} state={viewState} openEditor={openEditor} quickUpdate={quickUpdate}/>}
      {tab === "projects" && <Projects data={activeWorkspace} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "papers" && <Papers data={activeWorkspace} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "notes" && <Notes items={activeWorkspace.notes} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "star" && <Experiences data={activeWorkspace} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "portfolio" && <Portfolio items={activeWorkspace.portfolioItems} refs={activeReferences} state={viewState} openEditor={openEditor}/>}
      {tab === "jobs" && <Jobs state={viewState}/>}
      {tab === "calendar" && <Calendar tasks={workspace.todos} state={viewState} openEditor={openEditor}/>}
      {tab === "ai" && <AI/>}
      {tab === "settings" && <Settings counts={counts} legacyCounts={legacyCounts} state={viewState} onImportComplete={() => user?.id && loadWorkspace(user.id)}/>}

      {editor && <RecordEditor editor={editor} refs={references} saveState={saveState} setSaveState={setSaveState} onSave={saveRecord} onDelete={deleteRecord} onClose={closeEditor}/>}
    </main>
  </div>;
}

function Dashboard({ data, allCounts, counts, refs, state, openEditor }) {
  const today = todayIso();
  const weekEnd = addDays(today, 7);
  const openTodos = data.todos.filter(item => !isDone(item));
  const todayTodos = openTodos.filter(item => todoDate(item) === today);
  const overdueTodos = openTodos.filter(item => todoDate(item) && todoDate(item) < today);
  const weekTodos = openTodos.filter(item => todoDate(item) && todoDate(item) > today && todoDate(item) <= weekEnd);
  const papersNeedingAttention = data.papers.filter(item => !["published", "archived"].includes(item.status)).slice(0, 5);

  return <DataViewState state={state} isEmpty={allCounts.total === 0} emptyTitle="아직 표시할 데이터가 없습니다" emptyBody="로그인 후 Todo와 새로 작성한 연구 기록이 여기에 표시됩니다.">
    <section className="hero panel">
      <div>
        <span className="eyebrow">TODAY</span>
        <h2>{todayTodos.length}개 오늘 Todo</h2>
        <p>지연 {overdueTodos.length}개, 7일 내 마감 {weekTodos.length}개. Projects, Papers, Notes, Experiences, Portfolio는 새로 작성한 항목만 표시합니다.</p>
      </div>
      <button className="secondary" onClick={() => openEditor("todo", null, { due_on: today })}>Add Todo</button>
    </section>

    <div className="three">
      <ActionPanel title="Today's Open Todos" items={todayTodos} empty="Nothing due today." render={item => <TaskLine key={item.id} item={item} onClick={() => openEditor("todo", item)}/>}/>
      <ActionPanel title="Overdue Todos" items={overdueTodos.slice(0, 8)} empty="No overdue todos." render={item => <TaskLine key={item.id} item={item} onClick={() => openEditor("todo", item)}/>}/>
      <ActionPanel title="This Week" items={weekTodos.slice(0, 8)} empty="No deadlines this week." render={item => <TaskLine key={item.id} item={item} onClick={() => openEditor("todo", item)}/>}/>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title="진행 중 Projects" sub="새로 작성한 프로젝트 기준"/>
        <InlineEmpty items={data.projects} message="아직 등록한 프로젝트가 없습니다."/>
        {data.projects.filter(project => project.status === "active").slice(0, 5).map(project => <div className="projectRow clickable" key={project.id} onClick={() => openEditor("project", project)}>
          <div><b>{displayTitle(project, "Untitled project")}</b><span>{project.next_action || project.summary || "No next action recorded"}</span></div><strong>{progressValue(project.progress)}%</strong>
        </div>)}
      </section>
      <section className="panel section">
        <SectionTitle title="작성 중 Papers" sub="새로 작성한 논문 기록 기준"/>
        <InlineEmpty items={papersNeedingAttention} message="아직 등록한 논문이 없습니다."/>
        {papersNeedingAttention.map(paper => <ProgressRow key={paper.id} label={displayTitle(paper, "Untitled paper")} value={progressValue(paper.progress)} status={`${paperStage(paper)} | ${refs.figuresByPaper.get(paper.id)?.length || 0} figures`} onClick={() => openEditor("paper", paper)}/>)}
      </section>
    </div>

    <div className="grid4">
      <KPI label="Todos" value={allCounts.todos}/>
      <KPI label="Projects" value={counts.projects}/>
      <KPI label="Notes" value={counts.notes}/>
      <KPI label="Portfolio" value={counts.portfolioItems}/>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title="최근 Research Notes" sub="새 기록 기준"/>
        <InlineEmpty items={data.notes} message="아직 작성한 노트가 없습니다."/>
        {data.notes.slice(0, 4).map(note => <CompactRecord key={note.id} title={displayTitle(note, "Untitled note")} meta={note.note_type || "research"} onClick={() => openEditor("note", note)}/>)}
      </section>
      <section className="panel section">
        <SectionTitle title="최근 STAR Experiences" sub="자기소개서와 면접 소재"/>
        <InlineEmpty items={data.experiences} message="아직 등록한 경험이 없습니다."/>
        {data.experiences.slice(0, 4).map(item => <CompactRecord key={item.id} title={displayTitle(item, "Untitled experience")} meta={item.category || item.role || "Experience"} onClick={() => openEditor("experience", item)}/>)}
      </section>
    </div>
  </DataViewState>;
}

function Todos({ items, refs, state, openEditor, quickUpdate }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [statusFilter, setStatusFilter] = useState("open");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");

  const years = useMemo(() => availableYears(items.map(todoDate)), [items]);
  const categories = useMemo(() => ["All", ...unique(items.map(todoCategory).filter(Boolean))], [items]);
  const filtered = items.filter(item => {
    const date = todoDate(item);
    const itemDate = date ? new Date(`${date}T00:00:00`) : null;
    if (itemDate && itemDate.getFullYear() !== Number(year)) return false;
    if (itemDate && itemDate.getMonth() !== month) return false;
    if (!itemDate && (Number(year) !== 1970 || month !== 0)) return false;
    if (statusFilter === "open" && isDone(item)) return false;
    if (statusFilter === "completed" && !isDone(item)) return false;
    if (categoryFilter !== "All" && todoCategory(item) !== categoryFilter) return false;
    if (priorityFilter !== "All" && String(item.priority || 3) !== priorityFilter) return false;
    return true;
  });
  const byDate = groupTodosByDate(filtered, todoDate, todayIso());

  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No todos found" emptyBody="Imported planner items and paper tasks will appear here.">
    <section className="panel section plannerShell">
      <div className="workspaceToolbar">
        <SectionTitle title="Planner" sub="Year, month, day and todos"/>
        <button className="secondary" onClick={() => openEditor("todo", null, { due_on: monthDate(year, month, 1) })}>Add Todo</button>
      </div>
      <div className="filterBar">
        <label><span>Year</span><select value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(item => <option key={item}>{item}</option>)}</select></label>
        <Segmented options={todoFilters} value={statusFilter} onChange={setStatusFilter}/>
        <label><span>Category</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Priority</span><select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>{["All", "1", "2", "3", "4", "5"].map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="monthTabs">
        {monthNames.map((name, index) => <button key={name} className={month === index ? "active" : ""} onClick={() => setMonth(index)}>{name.slice(0, 3)}</button>)}
      </div>
    </section>

    <div className="timeline">
      {byDate.length === 0 && <StatePanel title="No todos in this view" body="Change filters or add a todo for this month."/>}
      {byDate.map(([date, dayItems]) => <section className="panel dayGroup" key={date}>
        <button className="dayHeader" onClick={() => openEditor("todo", null, { due_on: date })}>
          <span><b>{formatDay(date)}</b><small>{formatWeekday(date)}</small></span>
          <strong>{dayItems.filter(item => !isDone(item)).length} open</strong>
        </button>
        {dayItems.map(item => <div className={isDone(item) ? "task done clickable" : "task clickable"} key={item.id} onClick={() => openEditor("todo", item)}>
          <button className="check" onClick={event => {
            event.stopPropagation();
            quickUpdate("todo", item, { completed: !isDone(item), title: item.title, date: todoDate(item), priority: item.priority, category: todoCategory(item), project_id: item.project_id || "", paper_id: item.paper_id || "" });
          }}>{isDone(item) ? "✓" : ""}</button>
          <b>{displayTitle(item, "Untitled todo")}</b>
          <small>{todoCategory(item)} | P{item.priority || 3} {refs.projectMap.get(item.project_id)?.title ? `| ${refs.projectMap.get(item.project_id).title}` : ""}</small>
        </div>)}
      </section>)}
    </div>
  </DataViewState>;
}

function Projects({ data, refs, state, openEditor }) {
  const [area, setArea] = useState("All");
  const filtered = data.projects.filter(project => area === "All" || projectArea(project) === area);

  return <DataViewState state={state} isEmpty={data.projects.length === 0} emptyTitle="No projects found" emptyBody="Imported projects will appear here.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title="Projects by Status" sub="Active work, held ideas and completed records"/>
        <button className="secondary" onClick={() => openEditor("project")}>Add Project</button>
      </div>
      <div className="filterBar">
        <label><span>Area</span><select value={area} onChange={event => setArea(event.target.value)}>{projectAreas.map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
    </section>
    {projectStatusGroups.map(([label, statuses]) => {
      const groupItems = filtered.filter(project => statuses.includes(project.status || "planning"));
      return <section className="panel section" key={label}>
        <SectionTitle title={label} sub={`${groupItems.length} projects`}/>
        <div className="cards">
          {groupItems.map(project => <ProjectCard key={project.id} project={project} data={data} refs={refs} openEditor={openEditor}/>)}
        </div>
        <InlineEmpty items={groupItems} message="No projects in this group."/>
      </section>;
    })}
  </DataViewState>;
}

function Papers({ data, refs, state, openEditor }) {
  const papersByStage = groupByStage(data.papers, paperStage, paperStages);

  return <DataViewState state={state} isEmpty={data.papers.length === 0} emptyTitle="No papers found" emptyBody="Imported papers and their figures will appear here.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title="Paper Workflow" sub="Ideas, writing, submission and publication"/>
        <button className="secondary" onClick={() => openEditor("paper")}>Add Paper</button>
      </div>
    </section>
    {papersByStage.map(([stage, papers]) => <section className="panel section" key={stage}>
      <SectionTitle title={stage} sub={`${papers.length} papers`}/>
      <div className="cards">
        {papers.map(paper => <PaperCard key={paper.id} paper={paper} data={data} refs={refs} openEditor={openEditor}/>)}
      </div>
      <InlineEmpty items={papers} message="No papers in this stage."/>
    </section>)}
  </DataViewState>;
}

function Notes({ items, refs, state, openEditor }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [project, setProject] = useState("All");
  const [paper, setPaper] = useState("All");
  const filtered = items.filter(note => {
    if (type !== "All" && normalizedNoteType(note) !== type) return false;
    if (project !== "All" && note.project_id !== project) return false;
    if (paper !== "All" && note.paper_id !== paper) return false;
    return textMatches(note, search, ["title", "body", "note_type"]);
  });
  const grouped = groupByValue(filtered, note => dateKey(note.updated_at || note.created_at));

  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No research notes found" emptyBody="Imported research-note records will appear here.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title="Research Notes" sub="Search and classify notes by type and relationship"/>
        <button className="secondary" onClick={() => openEditor("note")}>Add Note</button>
      </div>
      <div className="filterBar">
        <label><span>Search</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notes"/></label>
        <label><span>Type</span><select value={type} onChange={event => setType(event.target.value)}>{noteTypes.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Project</span><select value={project} onChange={event => setProject(event.target.value)}><option>All</option>{refs.projects.map(item => <option key={item.id} value={item.id}>{displayTitle(item, "Project")}</option>)}</select></label>
        <label><span>Paper</span><select value={paper} onChange={event => setPaper(event.target.value)}><option>All</option>{refs.papers.map(item => <option key={item.id} value={item.id}>{displayTitle(item, "Paper")}</option>)}</select></label>
      </div>
    </section>
    {grouped.map(([date, notes]) => <section className="panel section" key={date}>
      <SectionTitle title={date} sub={`${notes.length} notes`}/>
      <div className="cards">
        {notes.map(note => <article className="card noteCard clickable" key={note.id} onClick={() => openEditor("note", note)}>
          <span className="eyebrow">{normalizedNoteType(note)}</span><h3>{displayTitle(note, "Untitled note")}</h3><p>{note.body || "No note body recorded."}</p>
          <div className="metaLine"><span>{refs.projectMap.get(note.project_id)?.title || "No project"}</span><span>{refs.paperMap.get(note.paper_id)?.title || "No paper"}</span>{(note.tags || []).slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div>
        </article>)}
      </div>
    </section>)}
  </DataViewState>;
}

function Experiences({ data, refs, state, openEditor }) {
  const [year, setYear] = useState("All");
  const [month, setMonth] = useState("All");
  const [category, setCategory] = useState("All");
  const [skill, setSkill] = useState("All");
  const [project, setProject] = useState("All");
  const years = availableYears(data.experiences.map(experienceDate));
  const categories = ["All", ...unique(data.experiences.map(item => item.category).filter(Boolean))];
  const skills = ["All", ...unique(data.experiences.flatMap(experienceSkills))];
  const filtered = data.experiences.filter(item => {
    const date = experienceDate(item);
    if (year !== "All" && String(new Date(`${date}T00:00:00`).getFullYear()) !== String(year)) return false;
    if (month !== "All" && new Date(`${date}T00:00:00`).getMonth() !== Number(month)) return false;
    if (category !== "All" && item.category !== category) return false;
    if (skill !== "All" && !experienceSkills(item).includes(skill)) return false;
    if (project !== "All" && item.project_id !== project) return false;
    return true;
  });
  const byYear = groupTimeline(filtered, experienceDate);

  return <DataViewState state={state} isEmpty={data.experiences.length === 0} emptyTitle="No STAR experiences found" emptyBody="Imported experiences will appear here.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title="Experience Timeline" sub="Chronological STAR archive for interviews and applications"/>
        <button className="secondary" onClick={() => openEditor("experience", null, { occurred_on: todayIso() })}>Add Experience</button>
      </div>
      <div className="filterBar">
        <label><span>Year</span><select value={year} onChange={event => setYear(event.target.value)}><option>All</option>{years.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Month</span><select value={month} onChange={event => setMonth(event.target.value)}><option>All</option>{monthNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Skill</span><select value={skill} onChange={event => setSkill(event.target.value)}>{skills.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Project</span><select value={project} onChange={event => setProject(event.target.value)}><option>All</option>{refs.projects.map(item => <option key={item.id} value={item.id}>{displayTitle(item, "Project")}</option>)}</select></label>
      </div>
    </section>
    <TimelineArchive grouped={byYear} renderItem={item => <ExperienceCard key={item.id} item={item} refs={refs} openEditor={openEditor}/>}/>
  </DataViewState>;
}

function Portfolio({ items, refs, state, openEditor }) {
  const [year, setYear] = useState("All");
  const [category, setCategory] = useState("All");
  const years = availableYears(items.map(portfolioDateOrYear));
  const categories = ["All", ...unique([...portfolioCategories, ...items.map(portfolioCategory).filter(Boolean)])];
  const filtered = items.filter(item => {
    if (year !== "All" && String(portfolioYear(item)) !== String(year)) return false;
    if (category !== "All" && portfolioCategory(item) !== category) return false;
    return true;
  });
  const byYear = groupByValue(filtered, item => portfolioYear(item), "desc");

  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No portfolio items found" emptyBody="Imported portfolio items will appear here.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title="Portfolio Archive" sub="Achievements, outputs and evidence by year"/>
        <button className="secondary" onClick={() => openEditor("portfolio", null, { year: new Date().getFullYear() })}>Add Portfolio Item</button>
      </div>
      <div className="filterBar">
        <label><span>Year</span><select value={year} onChange={event => setYear(event.target.value)}><option>All</option>{years.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
    </section>
    {byYear.map(([yearKey, yearItems]) => <section className="panel section" key={yearKey}>
      <SectionTitle title={String(yearKey)} sub={`${yearItems.length} portfolio items`}/>
      {groupByValue(yearItems, portfolioCategory).map(([categoryKey, categoryItems]) => <div className="portfolioGroup" key={categoryKey}>
        <h4>{categoryKey}</h4>
        <div className="cards">
          {categoryItems.map(item => <PortfolioCard key={item.id} item={item} refs={refs} openEditor={openEditor}/>)}
        </div>
      </div>)}
    </section>)}
  </DataViewState>;
}

function Jobs({ state }) {
  return <DataViewState state={state} isEmpty={false}>
    <div className="panel tableWrap">
      <div className="tableHead"><span>Company</span><span>Role</span><span>Stage</span><span>Deadline</span></div>
      <div className="tableRow"><b>No Supabase job table</b><span>Job tracker data has not been modeled yet.</span><span className="badge">Placeholder</span><span>TBD</span></div>
    </div>
  </DataViewState>;
}

function Calendar({ tasks, state, openEditor }) {
  const [visibleDate, setVisibleDate] = useState(new Date());
  const month = useMemo(() => buildCalendarMonth(visibleDate), [visibleDate]);

  return <DataViewState state={state} isEmpty={tasks.length === 0} emptyTitle="No todos for the calendar" emptyBody="Todos with due dates will appear on the calendar.">
    <section className="panel section">
      <div className="workspaceToolbar">
        <SectionTitle title={`${monthNames[visibleDate.getMonth()]} ${visibleDate.getFullYear()}`} sub="Same Supabase todos as the Planner"/>
        <div className="toolbarActions"><button className="secondary" onClick={() => setVisibleDate(addMonths(visibleDate, -1))}>Previous</button><button className="secondary" onClick={() => setVisibleDate(addMonths(visibleDate, 1))}>Next</button></div>
      </div>
    </section>
    <section className="panel calendar">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <b className="dow" key={day}>{day}</b>)}
      {month.cells.map((day, index) => day === null
        ? <div className="cal muted" key={`blank-${index}`}/>
        : <button className="cal" key={day} onClick={() => openEditor("todo", null, { due_on: `${month.yearMonth}-${String(day).padStart(2, "0")}` })}>
          <strong>{day}</strong>
          {tasks.filter(item => todoDate(item) === `${month.yearMonth}-${String(day).padStart(2, "0")}`).map(item => <span className={isDone(item) ? "event done" : "event"} key={item.id} onClick={event => {
            event.stopPropagation();
            openEditor("todo", item);
          }}>{displayTitle(item, "Untitled todo")}</span>)}
        </button>)}
    </section>
  </DataViewState>;
}

function AI() {
  return <div className="aiGrid">
    <AIBox title="Paper Summary" desc="A future workflow can summarize research papers and extract aims, methods, evidence and next actions." action="Analyze PDF"/>
    <AIBox title="STAR to Cover Letter" desc="A future workflow can transform saved STAR experiences into role-specific cover letter material." action="Draft Text"/>
    <AIBox title="Research Writing" desc="A future workflow can help draft figure captions, discussion sections and research emails." action="Write Draft"/>
  </div>;
}

function Settings({ counts, legacyCounts, state, onImportComplete }) {
  return <>
    <section className="panel section">
      <SectionTitle title="Architecture" sub="Authenticated private workspace"/>
      <div className="arch">
        <div><b>Next.js App</b><span>Workspace UI</span></div>
        <div className="arrow">-&gt;</div>
        <div><b>Supabase Auth</b><span>Current user session</span></div>
        <div className="arrow">-&gt;</div>
        <div><b>PostgreSQL + RLS</b><span>User-owned records</span></div>
      </div>
      <p className="mutedText">The UI reads only authenticated Supabase rows for the current user. Imports preserve source metadata and never overwrite existing rows.</p>
    </section>

    <section className="panel section">
      <SectionTitle title="현재 작업 공간 Row Counts" sub={state.loadedAt ? `Last refreshed ${state.loadedAt.toLocaleTimeString()}` : "Todo는 전체 보존, 나머지는 새로 작성한 active 항목 기준"}/>
      <div className="importPreview">
        <PreviewStat label="Todos" value={counts.todos}/>
        <PreviewStat label="Portfolio Items" value={counts.portfolioItems}/>
        <PreviewStat label="Papers" value={counts.papers}/>
        <PreviewStat label="Figures" value={counts.paperFigures}/>
        <PreviewStat label="Notes" value={counts.notes}/>
        <PreviewStat label="Projects" value={counts.projects}/>
        <PreviewStat label="Experiences" value={counts.experiences}/>
        <PreviewStat label="Total" value={counts.total}/>
      </div>
    </section>

    <section className="panel section">
      <SectionTitle title="보존된 레거시 데이터" sub="삭제하지 않고 Supabase에 보존되어 있으며, 기본 화면에서는 숨김 처리됩니다."/>
      <div className="importPreview">
        <PreviewStat label="Projects" value={legacyCounts.projects}/>
        <PreviewStat label="Papers" value={legacyCounts.papers}/>
        <PreviewStat label="Figures" value={legacyCounts.paperFigures}/>
        <PreviewStat label="Notes" value={legacyCounts.notes}/>
        <PreviewStat label="Experiences" value={legacyCounts.experiences}/>
        <PreviewStat label="Portfolio Items" value={legacyCounts.portfolioItems}/>
        <PreviewStat label="Todos Hidden" value={0}/>
        <PreviewStat label="Total Preserved" value={legacyCounts.total}/>
      </div>
      <p className="mutedText">복구가 필요하면 Supabase에서 `source_file`, `source_key`, `raw_data`가 보존된 레코드를 다시 active로 표시하는 방식으로 되돌릴 수 있습니다. Todo 테이블은 이 분리 대상에서 제외했습니다.</p>
    </section>

    <ImportExistingData onImportComplete={onImportComplete}/>
  </>;
}

function ProjectCard({ project, data, refs, openEditor }) {
  const relatedTodos = data.todos.filter(item => item.project_id === project.id);
  const relatedPapers = data.papers.filter(item => item.project_id === project.id);
  const relatedNotes = data.notes.filter(item => item.project_id === project.id);
  const relatedExperiences = data.experiences.filter(item => item.project_id === project.id);

  return <article className="card clickable" onClick={() => openEditor("project", project)}>
    <div className="cardTop"><div><span className="eyebrow">{projectArea(project)}</span><h3>{displayTitle(project, "Untitled project")}</h3></div><strong>{progressValue(project.progress)}%</strong></div>
    <div className="progress"><i style={{ width: `${progressValue(project.progress)}%` }}/></div>
    <p><b>Next:</b> {project.next_action || project.summary || "No next action recorded"}</p>
    <div className="metaLine"><span>{relatedTodos.length} todos</span><span>{relatedPapers.length} papers</span><span>{relatedNotes.length} notes</span><span>{relatedExperiences.length} experiences</span></div>
    <div className="activityList">
      {recentActivity([project, ...relatedTodos, ...relatedPapers, ...relatedNotes, ...relatedExperiences]).slice(0, 3).map(item => <span key={`${item.id}-${item.updated_at}`}>{displayTitle(item, "Activity")} updated {dateKey(item.updated_at || item.created_at)}</span>)}
    </div>
  </article>;
}

function PaperCard({ paper, data, refs, openEditor }) {
  const figures = refs.figuresByPaper.get(paper.id) || [];
  const todos = data.todos.filter(item => item.paper_id === paper.id);
  const notes = data.notes.filter(item => item.paper_id === paper.id);

  return <article className="card clickable" onClick={() => openEditor("paper", paper)}>
    <div className="cardTop"><div><span className="eyebrow">{paperStage(paper)}</span><h3>{displayTitle(paper, "Untitled paper")}</h3></div><strong>{progressValue(paper.progress)}%</strong></div>
    <div className="progress"><i style={{ width: `${progressValue(paper.progress)}%` }}/></div>
    <p>{paper.abstract || paper.metadata?.summary || paper.journal || "No summary recorded."}</p>
    <div className="metaLine"><span>{refs.projectMap.get(paper.project_id)?.title || "No project"}</span><span>{figures.length} figures</span><span>{todos.length} tasks</span><span>{notes.length} notes</span><span>Deadline {paper.deadline_on || "TBD"}</span></div>
    <div className="toolbarActions">
      <button className="secondary" onClick={event => {
        event.stopPropagation();
        openEditor("figure", null, { paper_id: paper.id });
      }}>Add Figure</button>
    </div>
    {figures.length > 0 && <div className="figureList">
      {figures.map(figure => <button key={figure.id} onClick={event => {
        event.stopPropagation();
        openEditor("figure", figure);
      }}>
        <b>{figure.figure_label || "Figure"}</b>
        <span>{figure.title || figure.metadata?.claim || figure.caption || "Untitled figure"}</span>
      </button>)}
    </div>}
  </article>;
}

function ExperienceCard({ item, refs, openEditor }) {
  return <article className="timelineEntry clickable" onClick={() => openEditor("experience", item)}>
    <div className="cardTop"><h3>{displayTitle(item, "Untitled experience")}</h3><span className="badge">{item.category || "Experience"}</span></div>
    <p className="pre">{formatExperience(item)}</p>
    <div className="metaLine">
      <span>{refs.projectMap.get(item.project_id)?.title || "No project"}</span>
      <span>{refs.paperMap.get(item.metadata?.related_paper_id)?.title || "No paper"}</span>
      {experienceSkills(item).slice(0, 3).map(skill => <span key={skill}>{skill}</span>)}
    </div>
  </article>;
}

function PortfolioCard({ item, refs, openEditor }) {
  return <article className="card clickable" onClick={() => openEditor("portfolio", item)}>
    <div className="cardTop">
      <div><span className="eyebrow">{item.metadata?.status || item.visibility || "private"}</span><h3>{displayTitle(item, "Untitled portfolio item")}</h3></div>
      <span className="badge">{item.featured ? "Featured" : portfolioCategory(item)}</span>
    </div>
    <p>{item.summary || item.body || "No summary recorded."}</p>
    <div className="metaLine">
      <span>{refs.projectMap.get(item.project_id)?.title || "No project"}</span>
      <span>{refs.paperMap.get(item.paper_id)?.title || "No paper"}</span>
      {(item.metadata?.skills || []).slice(0, 3).map(skill => <span key={skill}>{skill}</span>)}
    </div>
  </article>;
}

function RecordEditor({ editor, refs, saveState, setSaveState, onSave, onDelete, onClose }) {
  const initial = useMemo(() => formInitialValues(editor.type, editor.record, editor.defaults), [editor]);
  const [values, setValues] = useState(initial);
  const title = `${editor.record?.id ? "Edit" : "Add"} ${editor.typeLabel || editor.type}`;

  useEffect(() => setValues(initial), [initial]);

  async function submit(event) {
    event.preventDefault();
    setSaveState({ ok: true, message: "Saving..." });
    try {
      await onSave(editor.type, editor.record, values);
      setSaveState({ ok: true, message: "Saved." });
      onClose();
    } catch (error) {
      setSaveState({ ok: false, message: error.message });
    }
  }

  return <div className="modalOverlay" role="dialog" aria-modal="true">
    <form className="editor panel" onSubmit={submit}>
      <div className="editorHead">
        <div><span className="eyebrow">SUPABASE EDITOR</span><h3>{title}</h3></div>
        <button type="button" className="iconButton" onClick={onClose}>x</button>
      </div>
      <EditorFields type={editor.type} values={values} setValues={setValues} refs={refs}/>
      {saveState && <div className={saveState.ok ? "importMessages success" : "importMessages error"}><p>{saveState.message}</p></div>}
      <div className="editorActions">
        {editor.record?.id && <button type="button" className="danger" onClick={() => onDelete(editor.type, editor.record)}>Delete</button>}
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary">Save</button>
      </div>
      {editor.record?.source_key && <p className="mutedText">Source metadata is preserved: {editor.record.source_file || "unknown"} / {editor.record.source_key}</p>}
    </form>
  </div>;
}

function EditorFields({ type, values, setValues, refs }) {
  const set = (key, value) => setValues(current => ({ ...current, [key]: value }));
  const commonRelations = <>
    <SelectField label="Related Project" value={values.project_id || ""} onChange={value => set("project_id", value)} options={[["", "None"], ...refs.projects.map(item => [item.id, displayTitle(item, "Project")])]}/>
    {["todo", "note", "experience", "portfolio", "paper"].includes(type) && <SelectField label="Related Paper" value={values.paper_id || ""} onChange={value => set("paper_id", value)} options={[["", "None"], ...refs.papers.map(item => [item.id, displayTitle(item, "Paper")])]}/>}
  </>;

  if (type === "todo") return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)} required/>
    <TextField label="Date" type="date" value={values.date} onChange={value => set("date", value)}/>
    <TextField label="Category" value={values.category} onChange={value => set("category", value)}/>
    <SelectField label="Priority" value={String(values.priority || 3)} onChange={value => set("priority", value)} options={["1", "2", "3", "4", "5"].map(item => [item, item])}/>
    <label className="checkField"><input type="checkbox" checked={Boolean(values.completed)} onChange={event => set("completed", event.target.checked)}/> Completed</label>
    {commonRelations}
    <TextArea label="Description" value={values.description} onChange={value => set("description", value)}/>
  </div>;

  if (type === "project") return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)} required/>
    <SelectField label="Status" value={values.status} onChange={value => set("status", value)} options={[["active", "Active"], ["paused", "On Hold"], ["completed", "Completed"], ["archived", "Archived"], ["planning", "Planning"]]}/>
    <SelectField label="Area" value={values.area} onChange={value => set("area", value)} options={projectAreas.filter(item => item !== "All").map(item => [item, item])}/>
    <TextField label="Progress" type="number" value={values.progress} onChange={value => set("progress", value)}/>
    <TextField label="Next Action" value={values.next_action} onChange={value => set("next_action", value)}/>
    <TextArea label="Summary" value={values.summary} onChange={value => set("summary", value)}/>
  </div>;

  if (type === "paper") return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)} required/>
    <SelectField label="Current Stage" value={values.stage} onChange={value => set("stage", value)} options={paperStages.map(item => [item, item])}/>
    <TextField label="Deadline" type="date" value={values.deadline_on} onChange={value => set("deadline_on", value)}/>
    <TextField label="Journal" value={values.journal} onChange={value => set("journal", value)}/>
    <TextField label="Role" value={values.role} onChange={value => set("role", value)}/>
    <TextField label="Skills" value={values.skills} onChange={value => set("skills", value)}/>
    {commonRelations}
    <TextArea label="Summary" value={values.summary} onChange={value => set("summary", value)}/>
  </div>;

  if (type === "figure") return <div className="editorGrid">
    <SelectField label="Paper" value={values.paper_id || ""} onChange={value => set("paper_id", value)} options={refs.papers.map(item => [item.id, displayTitle(item, "Paper")])}/>
    <TextField label="Label" value={values.figure_label} onChange={value => set("figure_label", value)}/>
    <TextField label="Title" value={values.title} onChange={value => set("title", value)}/>
    <TextField label="Status" value={values.status} onChange={value => set("status", value)}/>
    <TextField label="Claim" value={values.claim} onChange={value => set("claim", value)}/>
    <TextField label="Data" value={values.data} onChange={value => set("data", value)}/>
    <TextField label="Next Action" value={values.next} onChange={value => set("next", value)}/>
    <TextField label="Reference" value={values.reference} onChange={value => set("reference", value)}/>
    <TextArea label="Caption" value={values.caption} onChange={value => set("caption", value)}/>
  </div>;

  if (type === "note") return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)}/>
    <SelectField label="Note Type" value={values.note_type} onChange={value => set("note_type", value)} options={noteTypes.filter(item => item !== "All").map(item => [item, item])}/>
    <TextField label="Tags" value={values.tags} onChange={value => set("tags", value)}/>
    {commonRelations}
    <TextArea label="Body" value={values.body} onChange={value => set("body", value)} required/>
  </div>;

  if (type === "experience") return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)} required/>
    <TextField label="Date" type="date" value={values.occurred_on} onChange={value => set("occurred_on", value)}/>
    <TextField label="Category" value={values.category} onChange={value => set("category", value)}/>
    <TextField label="Skills / Keywords" value={values.skills} onChange={value => set("skills", value)}/>
    {commonRelations}
    <TextField label="GitHub URL" value={values.github_url} onChange={value => set("github_url", value)}/>
    <TextField label="Deployment URL" value={values.deployment_url} onChange={value => set("deployment_url", value)}/>
    <TextArea label="Situation" value={values.situation} onChange={value => set("situation", value)}/>
    <TextArea label="Task" value={values.task} onChange={value => set("task", value)}/>
    <TextArea label="Action" value={values.action} onChange={value => set("action", value)}/>
    <TextArea label="Result" value={values.result} onChange={value => set("result", value)}/>
    <TextArea label="Lessons Learned" value={values.lessons_learned} onChange={value => set("lessons_learned", value)}/>
    <TextArea label="AI Usage" value={values.ai_usage} onChange={value => set("ai_usage", value)}/>
    <TextArea label="Evidence / Attachments Reference" value={values.evidence} onChange={value => set("evidence", value)}/>
    <TextArea label="Interview Talking Point" value={values.interview_talking_point} onChange={value => set("interview_talking_point", value)}/>
  </div>;

  return <div className="editorGrid">
    <TextField label="Title" value={values.title} onChange={value => set("title", value)} required/>
    <TextField label="Year" type="number" value={values.year} onChange={value => set("year", value)}/>
    <SelectField label="Category" value={values.category} onChange={value => set("category", value)} options={portfolioCategories.map(item => [item, item])}/>
    <TextField label="Status" value={values.status} onChange={value => set("status", value)}/>
    <TextField label="Skills" value={values.skills} onChange={value => set("skills", value)}/>
    <TextField label="GitHub URL" value={values.github_url} onChange={value => set("github_url", value)}/>
    <TextField label="Deployment URL" value={values.deployment_url} onChange={value => set("deployment_url", value)}/>
    {commonRelations}
    <TextArea label="Summary" value={values.summary} onChange={value => set("summary", value)}/>
    <TextArea label="Evidence" value={values.evidence} onChange={value => set("evidence", value)}/>
  </div>;
}

function TextField({ label, value, onChange, type = "text", required = false }) {
  return <label><span>{label}</span><input type={type} value={value || ""} onChange={event => onChange(event.target.value)} required={required}/></label>;
}

function TextArea({ label, value, onChange, required = false }) {
  return <label className="wide"><span>{label}</span><textarea value={value || ""} onChange={event => onChange(event.target.value)} required={required}/></label>;
}

function SelectField({ label, value, onChange, options }) {
  return <label><span>{label}</span><select value={value || ""} onChange={event => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || "empty"} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function DataBanner({ state, counts, saveState }) {
  if (!state.configured) return <div className="demoBanner error">Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</div>;
  if (state.loading) return <div className="demoBanner">Loading authenticated Supabase data...</div>;
  if (!state.signedIn) return <div className="demoBanner">Sign in under Settings to load your private Supabase workspace data.</div>;
  if (state.error) return <div className="demoBanner error">{state.error}</div>;
  if (saveState) return <div className={saveState.ok ? "demoBanner" : "demoBanner error"}>{saveState.message}</div>;
  return <div className="demoBanner">Loaded {counts.total} Supabase rows for the authenticated user.</div>;
}

function DataViewState({ state, isEmpty, emptyTitle, emptyBody, children }) {
  if (state.loading) return <StatePanel title="Loading Supabase data" body="Fetching rows for the authenticated user."/>;
  if (!state.configured) return <StatePanel title="Supabase is not configured" body="Set the public Supabase URL and anon key to load workspace data."/>;
  if (!state.signedIn) return <StatePanel title="Sign in required" body="Open Settings and sign in before viewing imported private data."/>;
  if (state.error) return <StatePanel title="Could not load Supabase data" body={state.error} tone="error"/>;
  if (isEmpty) return <StatePanel title={emptyTitle} body={emptyBody}/>;
  return children;
}

function GlobalSearch({ query, setQuery, results, setTab, openEditor }) {
  return <section className="panel globalSearch">
    <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search todos, projects, papers, notes, experiences and portfolio"/>
    {query.trim() && <div className="searchResults">
      {results.length === 0 && <p className="mutedText">No matching records.</p>}
      {results.slice(0, 12).map(result => <button key={`${result.type}-${result.record.id}`} onClick={() => {
        setTab(result.tab);
        openEditor(result.type, result.record);
      }}>
        <span>{result.label}</span>
        <b>{result.title}</b>
        <small>{result.detail}</small>
      </button>)}
    </div>}
  </section>;
}

function StatePanel({ title, body, tone = "neutral" }) {
  return <section className={`panel statePanel ${tone}`}><h3>{title}</h3><p>{body}</p></section>;
}

function ActionPanel({ title, items, empty, render }) {
  return <section className="panel section actionPanel"><SectionTitle title={title} sub={`${items.length} items`}/><InlineEmpty items={items} message={empty}/>{items.map(render)}</section>;
}

function TimelineArchive({ grouped, renderItem }) {
  if (grouped.length === 0) return <StatePanel title="No timeline entries" body="Change filters or add a new experience."/>;
  return <div className="archive">
    {grouped.map(([year, months]) => <section className="panel section archiveYear" key={year}>
      <h3>{year}</h3>
      {months.map(([month, dates]) => <div className="archiveMonth" key={month}>
        <h4>{monthNames[Number(month)]}</h4>
        {dates.map(([date, items]) => <div className="archiveDay" key={date}>
          <div className="archiveDate"><b>{date}</b><span>{formatWeekday(date)}</span></div>
          <div className="archiveItems">{items.map(renderItem)}</div>
        </div>)}
      </div>)}
    </section>)}
  </div>;
}

function InlineEmpty({ items, message }) {
  if (items.length > 0) return null;
  return <p className="mutedText">{message}</p>;
}

function KPI({ label, value }) {
  return <div className="panel kpi"><span>{label}</span><b>{value}</b></div>;
}

function SectionTitle({ title, sub }) {
  return <div className="sectionTitle"><div><h3>{title}</h3><p>{sub}</p></div></div>;
}

function PreviewStat({ label, value }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

function Segmented({ options, value, onChange }) {
  return <div className="segmented">{options.map(option => <button key={option} className={value === option ? "active" : ""} onClick={() => onChange(option)}>{option}</button>)}</div>;
}

function TaskLine({ item, onClick }) {
  return <button className={isDone(item) ? "taskLine done" : "taskLine"} onClick={onClick}><b>{displayTitle(item, "Untitled todo")}</b><span>{todoDate(item) || "No date"} | {todoCategory(item)} | P{item.priority || 3}</span></button>;
}

function CompactRecord({ title, meta, onClick }) {
  return <button className="compactRecord" onClick={onClick}><b>{title}</b><span>{meta}</span></button>;
}

function ProgressRow({ label, value, status, onClick }) {
  return <button className="progressRow" onClick={onClick}><div><b>{label}</b><span>{status}</span></div><strong>{value}%</strong><div className="progress"><i style={{ width: `${value}%` }}/></div></button>;
}

function AIBox({ title, desc, action }) {
  return <article className="panel aiBox"><span className="eyebrow">AI WORKFLOW</span><h3>{title}</h3><p>{desc}</p><button className="secondary">{action}</button></article>;
}

async function fetchWorkspaceData(userId) {
  const loaded = await Promise.all([
    fetchTodos(userId),
    ...tableLoads.map(([key, table, select, orders]) => fetchRows({ key, table, select, orders, userId }))
  ]);

  const mismatch = loaded.find(result => result.count !== null && result.count !== result.rows.length);
  if (mismatch) throw new Error(`${mismatch.table}: loaded ${mismatch.rows.length} rows but Supabase reported ${mismatch.count}.`);
  return loaded.reduce((workspace, result) => ({ ...workspace, [result.key]: result.rows }), emptyWorkspace);
}

async function fetchTodos(userId) {
  try {
    return await fetchRows({
      key: "todos",
      table: TABLES.todos,
      select: DEFAULT_SELECTS.todos,
      orders: [["due_on", { ascending: true, nullsFirst: false }], ["created_at", { ascending: false }]],
      userId
    });
  } catch (error) {
    if (!/todo_date/i.test(error.message)) throw error;
    return fetchRows({
      key: "todos",
      table: TABLES.todos,
      select: DEFAULT_SELECTS.todos.replace(/,?\s*todo_date/g, ""),
      orders: [["due_on", { ascending: true, nullsFirst: false }], ["created_at", { ascending: false }]],
      userId
    });
  }
}

async function fetchRows({ key, table, select, orders, userId }) {
  const pageSize = 1000;
  const rows = [];
  let expectedCount = null;

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select, { count: "exact" }).eq("user_id", userId).range(from, from + pageSize - 1);
    for (const [column, options] of orders) query = query.order(column, options);
    const { data, error, count } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (expectedCount === null) expectedCount = count;
    rows.push(...(data || []));
    if ((data || []).length < pageSize || (expectedCount !== null && rows.length >= expectedCount)) break;
  }

  return { key, table, rows, count: expectedCount };
}

function buildSavePayload(type, record, values, userId) {
  const now = new Date().toISOString();
  const baseMetadata = { ...(record?.metadata || {}) };
  const source = record?.source_key ? {} : { source_file: "ui", source_key: `ui:${type}:${crypto.randomUUID()}`, raw_data: { created_from: "ui", created_at: now } };

  if (type === "todo") {
    const completed = Boolean(values.completed);
    return payload(TABLES.todos, {
      ...source,
      user_id: userId,
      title: values.title || "Untitled todo",
      description: emptyToNull(values.description),
      due_on: emptyToNull(values.date),
      todo_date: values.date || record?.todo_date || "1970-01-01",
      status: completed ? "done" : "open",
      completed_at: completed ? (record?.completed_at || now) : null,
      priority: clampPriority(values.priority),
      project_id: emptyToNull(values.project_id),
      paper_id: emptyToNull(values.paper_id),
      metadata: mergeMetadata(baseMetadata, { category: values.category })
    });
  }

  if (type === "project") {
    return payload(TABLES.projects, {
      ...source,
      user_id: userId,
      title: values.title || "Untitled project",
      status: values.status || "planning",
      progress: progressValue(values.progress),
      next_action: emptyToNull(values.next_action),
      summary: emptyToNull(values.summary),
      metadata: mergeMetadata(baseMetadata, { workspace_active: true, area: values.area })
    });
  }

  if (type === "paper") {
    return payload(TABLES.papers, {
      ...source,
      user_id: userId,
      project_id: emptyToNull(values.project_id),
      title: values.title || "Untitled paper",
      journal: emptyToNull(values.journal),
      abstract: emptyToNull(values.summary),
      deadline_on: emptyToNull(values.deadline_on),
      status: dbPaperStatus(values.stage),
      metadata: mergeMetadata(baseMetadata, { workspace_active: true, workflow_stage: values.stage, role: values.role, skills: splitList(values.skills) })
    });
  }

  if (type === "figure") {
    return payload(TABLES.paperFigures, {
      ...source,
      user_id: userId,
      paper_id: emptyToNull(values.paper_id),
      project_id: refsProjectForPaper(values.paper_id),
      figure_label: emptyToNull(values.figure_label),
      title: values.title || values.claim || values.figure_label || "Untitled figure",
      caption: emptyToNull(values.caption),
      status: values.status || "draft",
      metadata: mergeMetadata(baseMetadata, { workspace_active: true, claim: values.claim, data: values.data, next: values.next, reference: values.reference })
    });
  }

  if (type === "note") {
    return payload(TABLES.notes, {
      ...source,
      user_id: userId,
      project_id: emptyToNull(values.project_id),
      paper_id: emptyToNull(values.paper_id),
      title: emptyToNull(values.title),
      body: values.body || "",
      note_type: dbNoteType(values.note_type),
      tags: splitList(values.tags),
      metadata: mergeMetadata(baseMetadata, { workspace_active: true, display_type: values.note_type })
    });
  }

  if (type === "experience") {
    return payload(TABLES.experiences, {
      ...source,
      user_id: userId,
      project_id: emptyToNull(values.project_id),
      title: values.title || "Untitled experience",
      category: emptyToNull(values.category),
      situation: emptyToNull(values.situation),
      task: emptyToNull(values.task),
      action: emptyToNull(values.action),
      result: emptyToNull(values.result),
      reflection: emptyToNull(values.lessons_learned),
      tags: splitList(values.skills),
      occurred_on: emptyToNull(values.occurred_on),
      metadata: mergeMetadata(baseMetadata, {
        workspace_active: true,
        related_paper_id: values.paper_id,
        lessons_learned: values.lessons_learned,
        ai_usage: values.ai_usage,
        skills: splitList(values.skills),
        github_url: values.github_url,
        deployment_url: values.deployment_url,
        evidence: values.evidence,
        interview_talking_point: values.interview_talking_point
      })
    });
  }

  return payload(TABLES.portfolioItems, {
    ...source,
    user_id: userId,
    project_id: emptyToNull(values.project_id),
    paper_id: emptyToNull(values.paper_id),
    title: values.title || "Untitled portfolio item",
    summary: emptyToNull(values.summary),
    item_type: dbPortfolioType(values.category),
    external_url: emptyToNull(values.deployment_url || values.github_url),
    published_at: values.year ? `${values.year}-01-01T00:00:00.000Z` : null,
    metadata: mergeMetadata(baseMetadata, {
      workspace_active: true,
      year: values.year,
      category: values.category,
      status: values.status,
      evidence: values.evidence,
      github_url: values.github_url,
      deployment_url: values.deployment_url,
      skills: splitList(values.skills)
    })
  });
}

function payload(table, row) {
  return { table, row: removeUndefinedValues(row) };
}

function formInitialValues(type, record, defaults = {}) {
  const meta = record?.metadata || {};
  if (type === "todo") return {
    title: record?.title || defaults.title || "",
    date: record ? todoDate(record) || "" : defaults.due_on || todayIso(),
    category: todoCategory(record || defaults),
    priority: record?.priority || defaults.priority || 3,
    completed: record ? isDone(record) : false,
    project_id: record?.project_id || defaults.project_id || "",
    paper_id: record?.paper_id || defaults.paper_id || "",
    description: record?.description || ""
  };
  if (type === "project") return { title: record?.title || "", status: record?.status || "planning", area: meta.area || "Research", progress: record?.progress || 0, next_action: record?.next_action || "", summary: record?.summary || "" };
  if (type === "paper") return { title: record?.title || "", stage: paperStage(record || {}), deadline_on: record?.deadline_on || "", journal: record?.journal || "", role: meta.role || "", skills: listText(meta.skills), project_id: record?.project_id || "", paper_id: record?.id || "", summary: record?.abstract || meta.summary || "" };
  if (type === "figure") return { paper_id: record?.paper_id || defaults.paper_id || "", figure_label: record?.figure_label || "", title: record?.title || "", status: record?.status || "draft", claim: meta.claim || "", data: stringifyMeta(meta.data), next: meta.next || "", reference: meta.reference || "", caption: record?.caption || "" };
  if (type === "note") return { title: record?.title || "", note_type: normalizedNoteType(record || {}), tags: listText(record?.tags), project_id: record?.project_id || "", paper_id: record?.paper_id || "", body: record?.body || "" };
  if (type === "experience") return {
    title: record?.title || "",
    occurred_on: record?.occurred_on || defaults.occurred_on || todayIso(),
    category: record?.category || "",
    skills: listText(meta.skills || record?.tags),
    project_id: record?.project_id || "",
    paper_id: meta.related_paper_id || "",
    github_url: meta.github_url || "",
    deployment_url: meta.deployment_url || "",
    situation: record?.situation || "",
    task: record?.task || "",
    action: record?.action || "",
    result: record?.result || "",
    lessons_learned: meta.lessons_learned || record?.reflection || "",
    ai_usage: meta.ai_usage || "",
    evidence: meta.evidence || "",
    interview_talking_point: meta.interview_talking_point || ""
  };
  return {
    title: record?.title || "",
    year: portfolioYear(record || defaults),
    category: portfolioCategory(record || defaults),
    status: meta.status || record?.visibility || "",
    summary: record?.summary || "",
    evidence: meta.evidence || "",
    github_url: meta.github_url || "",
    deployment_url: meta.deployment_url || record?.external_url || "",
    skills: listText(meta.skills),
    project_id: record?.project_id || "",
    paper_id: record?.paper_id || ""
  };
}

function tableForEditorType(type) {
  return {
    todo: { table: TABLES.todos },
    project: { table: TABLES.projects },
    paper: { table: TABLES.papers },
    figure: { table: TABLES.paperFigures },
    note: { table: TABLES.notes },
    experience: { table: TABLES.experiences },
    portfolio: { table: TABLES.portfolioItems }
  }[type];
}

function buildReferences(data) {
  return {
    projects: data.projects,
    papers: data.papers,
    projectMap: new Map(data.projects.map(item => [item.id, item])),
    paperMap: new Map(data.papers.map(item => [item.id, item])),
    figuresByPaper: groupBy(data.paperFigures, "paper_id")
  };
}

function toActiveWorkspace(data) {
  return {
    todos: data.todos,
    projects: data.projects.filter(isActiveWorkspaceRecord),
    papers: data.papers.filter(isActiveWorkspaceRecord),
    paperFigures: data.paperFigures.filter(isActiveWorkspaceRecord),
    notes: data.notes.filter(isActiveWorkspaceRecord),
    experiences: data.experiences.filter(isActiveWorkspaceRecord),
    portfolioItems: data.portfolioItems.filter(isActiveWorkspaceRecord)
  };
}

function isActiveWorkspaceRecord(record) {
  return record?.source_file === "ui" || record?.metadata?.workspace_active === true;
}

function buildCounts(data) {
  return {
    todos: data.todos.length,
    projects: data.projects.length,
    papers: data.papers.length,
    paperFigures: data.paperFigures.length,
    notes: data.notes.length,
    experiences: data.experiences.length,
    portfolioItems: data.portfolioItems.length,
    total: data.todos.length + data.projects.length + data.papers.length + data.paperFigures.length + data.notes.length + data.experiences.length + data.portfolioItems.length
  };
}

function buildLegacyCounts(allData, activeData) {
  return {
    projects: allData.projects.length - activeData.projects.length,
    papers: allData.papers.length - activeData.papers.length,
    paperFigures: allData.paperFigures.length - activeData.paperFigures.length,
    notes: allData.notes.length - activeData.notes.length,
    experiences: allData.experiences.length - activeData.experiences.length,
    portfolioItems: allData.portfolioItems.length - activeData.portfolioItems.length,
    total: (allData.projects.length - activeData.projects.length) +
      (allData.papers.length - activeData.papers.length) +
      (allData.paperFigures.length - activeData.paperFigures.length) +
      (allData.notes.length - activeData.notes.length) +
      (allData.experiences.length - activeData.experiences.length) +
      (allData.portfolioItems.length - activeData.portfolioItems.length)
  };
}

function searchWorkspace(data, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [
    ...data.todos.map(record => searchResult("todo", "Todos", "todos", record, [record.title, record.description, todoCategory(record)])),
    ...data.projects.map(record => searchResult("project", "Projects", "projects", record, [record.title, record.summary, record.next_action, projectArea(record)])),
    ...data.papers.map(record => searchResult("paper", "Papers", "papers", record, [record.title, record.abstract, record.journal, paperStage(record)])),
    ...data.notes.map(record => searchResult("note", "Notes", "notes", record, [record.title, record.body, record.note_type])),
    ...data.experiences.map(record => searchResult("experience", "Experiences", "star", record, [record.title, record.category, record.situation, record.action, record.result])),
    ...data.portfolioItems.map(record => searchResult("portfolio", "Portfolio", "portfolio", record, [record.title, record.summary, portfolioCategory(record)]))
  ].filter(result => result.haystack.includes(q));
}

function searchResult(type, label, tab, record, values) {
  return { type, label, tab, record, title: displayTitle(record, "Untitled"), detail: values.filter(Boolean).slice(1, 3).join(" | "), haystack: values.filter(Boolean).join(" ").toLowerCase() };
}

function groupTimeline(items, getDate) {
  const years = groupByValue(items, item => new Date(`${getDate(item)}T00:00:00`).getFullYear(), "desc");
  return years.map(([year, yearItems]) => [year, groupByValue(yearItems, item => new Date(`${getDate(item)}T00:00:00`).getMonth()).map(([month, monthItems]) => [month, groupByValue(monthItems, getDate, "desc")])]);
}

function groupByValue(items, getValue, direction = "asc") {
  const map = new Map();
  for (const item of items) {
    const value = getValue(item) || "Unsorted";
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(item);
  }
  return Array.from(map.entries()).sort(([a], [b]) => direction === "desc" ? String(b).localeCompare(String(a)) : String(a).localeCompare(String(b)));
}

function groupByStage(items, getStage, stages) {
  const map = new Map(stages.map(stage => [stage, []]));
  for (const item of items) {
    const stage = getStage(item);
    if (!map.has(stage)) map.set(stage, []);
    map.get(stage).push(item);
  }
  return Array.from(map.entries());
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const value = item[key];
    if (!value) continue;
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(item);
  }
  return grouped;
}

function textMatches(item, query, fields) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return fields.map(field => item[field]).filter(Boolean).join(" ").toLowerCase().includes(q);
}

function displayTitle(item, fallback) {
  return item?.title || item?.name || item?.raw_data?.title || item?.raw_data?.name || fallback;
}

function progressValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isDone(item) {
  return item?.status === "done" || Boolean(item?.completed_at);
}

function todoDate(item) {
  return item?.due_on || item?.todo_date || null;
}

function todoCategory(item) {
  return item?.metadata?.category || item?.raw_data?.category || item?.category || "General";
}

function todoPriorityLabel(item) {
  return item?.metadata?.original_priority || `P${item?.priority || 3}`;
}

function projectArea(project) {
  return project?.metadata?.area || project?.raw_data?.area || "Research";
}

function paperStage(paper) {
  const metaStage = paper?.metadata?.workflow_stage;
  if (paperStages.includes(metaStage)) return metaStage;
  return {
    to_read: "Idea",
    reading: "Idea",
    reviewed: "In Progress",
    analysis: "In Progress",
    drafting: "Writing",
    manuscript: "Writing",
    submitted: "Submitted",
    published: "Published",
    archived: "Archived"
  }[paper?.status] || "In Progress";
}

function normalizedNoteType(note) {
  const display = note?.metadata?.display_type;
  if (display) return display;
  return {
    meeting: "meeting",
    research: "research",
    paper: "paper",
    figure: "experiment",
    career: "miscellaneous",
    idea: "idea",
    portfolio: "miscellaneous"
  }[note?.note_type] || "research";
}

function experienceDate(item) {
  return item?.occurred_on || dateKey(item?.created_at) || "1970-01-01";
}

function experienceSkills(item) {
  return unique([...(item?.metadata?.skills || []), ...(item?.tags || [])].filter(Boolean));
}

function portfolioYear(item) {
  const year = item?.metadata?.year || item?.raw_data?.year || (item?.published_at ? new Date(item.published_at).getFullYear() : null);
  return year ? String(year) : "Unsorted";
}

function portfolioDateOrYear(item) {
  const year = portfolioYear(item);
  return year === "Unsorted" ? null : `${year}-01-01`;
}

function portfolioCategory(item) {
  return item?.metadata?.category || {
    project: "Research Project",
    paper: "Publication",
    figure: "Research Project",
    experience: "Other",
    note: "Other",
    link: "Other",
    case_study: "Research Project"
  }[item?.item_type] || "Other";
}

function formatExperience(item) {
  const lines = [["S", item.situation], ["T", item.task], ["A", item.action], ["R", item.result], ["Lessons", item.metadata?.lessons_learned || item.reflection], ["AI", item.metadata?.ai_usage]].filter(([, value]) => value);
  if (lines.length === 0) return item.summary || item.raw_data?.body || "No STAR details recorded.";
  return lines.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function recentActivity(items) {
  return items.filter(Boolean).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}

function availableYears(values) {
  const current = new Date().getFullYear();
  const years = unique(values.map(value => {
    if (!value) return null;
    const date = String(value).length === 4 ? new Date(`${value}-01-01T00:00:00`) : new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.getFullYear();
  }).filter(Boolean));
  return unique([current, ...years]).sort((a, b) => b - a);
}

function monthDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDay(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return `${monthNames[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

function formatWeekday(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return weekdays[parsed.getDay()];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function dateKey(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function buildCalendarMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = first.getDay();
  return {
    yearMonth: `${year}-${String(month + 1).padStart(2, "0")}`,
    cells: [...Array(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)]
  };
}

function dbPaperStatus(stage) {
  return {
    Idea: "reading",
    "In Progress": "analysis",
    Writing: "drafting",
    Submitted: "submitted",
    Revision: "submitted",
    Accepted: "submitted",
    Published: "published",
    Archived: "archived"
  }[stage] || "analysis";
}

function dbNoteType(type) {
  return {
    meeting: "meeting",
    research: "research",
    paper: "paper",
    idea: "idea",
    experiment: "figure",
    feedback: "research",
    miscellaneous: "research"
  }[type] || "research";
}

function dbPortfolioType(category) {
  return {
    "Research Project": "project",
    Publication: "paper",
    Award: "case_study",
    "Presentation / Seminar": "case_study",
    "Education / Training": "case_study",
    Certification: "case_study",
    "Development Project": "project",
    Other: "case_study"
  }[category] || "case_study";
}

function mergeMetadata(base, next) {
  return Object.fromEntries(Object.entries({ ...base, ...next }).filter(([, value]) => value !== undefined && value !== ""));
}

function splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function listText(value) {
  return Array.isArray(value) ? value.join(", ") : value || "";
}

function stringifyMeta(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function clampPriority(value) {
  return Math.max(1, Math.min(5, Number(value) || 3));
}

function emptyToNull(value) {
  return value === "" || value === undefined ? null : value;
}

function removeUndefinedValues(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function unique(values) {
  return Array.from(new Set(values));
}

function refsProjectForPaper() {
  return undefined;
}
