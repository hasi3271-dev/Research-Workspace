"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ImportExistingData from "./import-existing-data";
import { DEFAULT_SELECTS, TABLES } from "../lib/data-model";
import { supabase } from "../lib/supabase";

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

  const figuresByPaper = useMemo(() => groupBy(workspace.paperFigures, "paper_id"), [workspace.paperFigures]);
  const counts = useMemo(() => buildCounts(workspace), [workspace]);
  const viewState = {
    loading: authLoading || dataState.loading,
    error: dataState.error,
    signedIn: Boolean(user?.id),
    configured: Boolean(supabase),
    loadedAt: dataState.loadedAt
  };

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

      <DataBanner state={viewState} counts={counts}/>

      {tab === "dashboard" && <Dashboard data={workspace} counts={counts} figuresByPaper={figuresByPaper} state={viewState}/>}
      {tab === "todos" && <Todos items={workspace.todos} state={viewState}/>}
      {tab === "projects" && <Projects items={workspace.projects} state={viewState}/>}
      {tab === "papers" && <Papers items={workspace.papers} figuresByPaper={figuresByPaper} state={viewState}/>}
      {tab === "notes" && <Notes items={workspace.notes} state={viewState}/>}
      {tab === "star" && <Star items={workspace.experiences} state={viewState}/>}
      {tab === "portfolio" && <Portfolio items={workspace.portfolioItems} state={viewState}/>}
      {tab === "jobs" && <Jobs state={viewState}/>}
      {tab === "calendar" && <Calendar tasks={workspace.todos} state={viewState}/>}
      {tab === "ai" && <AI/>}
      {tab === "settings" && <Settings counts={counts} state={viewState} onImportComplete={() => user?.id && loadWorkspace(user.id)}/>}
    </main>
  </div>;
}

function Dashboard({ data, counts, figuresByPaper, state }) {
  const today = todayIso();
  const openTodos = data.todos.filter(item => !isDone(item));
  const todayTodos = data.todos.filter(item => todoDate(item) === today).slice(0, 6);
  const upcomingTodos = openTodos.slice(0, 6);
  const dashboardTodos = todayTodos.length > 0 ? todayTodos : upcomingTodos;

  return <DataViewState state={state} isEmpty={counts.total === 0} emptyTitle="No workspace data yet" emptyBody="Import existing data or add Supabase rows for this user to populate the dashboard.">
    <section className="hero panel">
      <div>
        <span className="eyebrow">WORKSPACE OVERVIEW</span>
        <h2>Authenticated research data from Supabase</h2>
        <p>This dashboard reads projects, papers, figures, notes, experiences, portfolio items and todos for the signed-in user.</p>
      </div>
    </section>

    <div className="grid4">
      <KPI label="Open Todos" value={openTodos.length}/>
      <KPI label="Projects" value={counts.projects}/>
      <KPI label="Papers" value={counts.papers}/>
      <KPI label="Portfolio Items" value={counts.portfolioItems}/>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title={todayTodos.length > 0 ? "Today's Tasks" : "Upcoming Tasks"} sub={`${dashboardTodos.length} todos loaded from Supabase`}/>
        <InlineEmpty items={dashboardTodos} message="No open todos to show."/>
        {dashboardTodos.map(item => <TaskRow key={item.id} item={item}/>)}
      </section>

      <section className="panel section">
        <SectionTitle title="Paper Progress" sub={`${counts.paperFigures} related figures loaded`}/>
        <InlineEmpty items={data.papers} message="No papers to show."/>
        {data.papers.slice(0, 4).map(item => <ProgressRow key={item.id} label={displayTitle(item, "Untitled paper")} value={progressValue(item.progress)} status={`${displayStatus(item.status)} | ${figuresByPaper.get(item.id)?.length || 0} figures`}/>)}
      </section>
    </div>

    <div className="two">
      <section className="panel section">
        <SectionTitle title="Research Projects" sub={`${counts.projects} projects loaded`}/>
        <InlineEmpty items={data.projects} message="No projects to show."/>
        {data.projects.slice(0, 5).map(item => <div className="projectRow" key={item.id}><div><b>{displayTitle(item, "Untitled project")}</b><span>{item.next_action || item.summary || "No next action recorded"}</span></div><strong>{progressValue(item.progress)}%</strong></div>)}
      </section>
      <section className="panel section">
        <SectionTitle title="Recent Experience" sub={`${counts.experiences} STAR experiences loaded`}/>
        <InlineEmpty items={data.experiences} message="No experiences to show."/>
        {data.experiences.slice(0, 4).map(item => <div className="miniCard" key={item.id}><b>{displayTitle(item, "Untitled experience")}</b><span>{item.category || item.role || "Experience"}</span></div>)}
      </section>
    </div>
  </DataViewState>;
}

function Todos({ items, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No todos found" emptyBody="Imported planner items and paper tasks will appear here.">
    <div className="cards">
      {items.map(item => <article className="panel card" key={item.id}>
        <div className="cardTop">
          <div><span className="eyebrow">{todoGroup(item)}</span><h3>{displayTitle(item, "Untitled todo")}</h3></div>
          <span className="badge">{displayStatus(item.status)}</span>
        </div>
        <p>{item.description || item.metadata?.original_priority || "No description recorded."}</p>
        <div className="metaLine">
          <span>Priority {item.priority || 3}</span>
          <span>{item.metadata?.original_priority || "mapped priority"}</span>
          <span>{todoDate(item) || "No due date"}</span>
        </div>
      </article>)}
    </div>
  </DataViewState>;
}

function Projects({ items, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No projects found" emptyBody="Imported projects will appear here.">
    <div className="cards">
      {items.map(item => <article className="panel card" key={item.id}>
        <div className="cardTop"><div><span className="eyebrow">{displayStatus(item.status)}</span><h3>{displayTitle(item, "Untitled project")}</h3></div><strong>{progressValue(item.progress)}%</strong></div>
        <div className="progress"><i style={{ width: `${progressValue(item.progress)}%` }}/></div>
        <p><b>Next:</b> {item.next_action || item.summary || "No next action recorded"}</p>
        <div className="metaLine"><span>{dateRange(item.started_on, item.target_on)}</span><span>{item.source_file || "Supabase"}</span></div>
      </article>)}
    </div>
  </DataViewState>;
}

function Papers({ items, figuresByPaper, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No papers found" emptyBody="Imported papers and their figures will appear here.">
    <div className="cards">
      {items.map(item => {
        const figures = figuresByPaper.get(item.id) || [];
        return <article className="panel card" key={item.id}>
          <div className="cardTop"><div><span className="eyebrow">{displayStatus(item.status)}</span><h3>{displayTitle(item, "Untitled paper")}</h3></div><strong>{progressValue(item.progress)}%</strong></div>
          <div className="progress"><i style={{ width: `${progressValue(item.progress)}%` }}/></div>
          <p>{item.abstract || item.journal || item.citation_key || "No abstract recorded."}</p>
          <div className="metaLine"><span>{figures.length} Figures</span><span>Deadline {item.deadline_on || "TBD"}</span><span>{item.publication_year || "Year TBD"}</span></div>
          {figures.length > 0 && <div className="figureList">
            {figures.slice(0, 4).map(figure => <div key={figure.id}>
              <b>{figure.figure_label || "Figure"}</b>
              <span>{figure.title || figure.caption || figure.metadata?.claim || "Untitled figure"}</span>
            </div>)}
          </div>}
        </article>;
      })}
    </div>
  </DataViewState>;
}

function Notes({ items, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No research notes found" emptyBody="Imported research-note records will appear here.">
    <div className="cards">
      {items.map(item => <article className="panel card" key={item.id}>
        <span className="eyebrow">{item.note_type || "research"}</span><h3>{displayTitle(item, "Untitled note")}</h3><p>{item.body || "No note body recorded."}</p>
        <div className="metaLine">{(item.tags || []).slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}<span>{item.source_file || "Supabase"}</span></div>
      </article>)}
    </div>
  </DataViewState>;
}

function Star({ items, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No STAR experiences found" emptyBody="Imported experiences will appear here.">
    <div className="cards">
      {items.map(item => <article className="panel card" key={item.id}>
        <div className="cardTop"><h3>{displayTitle(item, "Untitled experience")}</h3><span className="badge">{item.category || "Experience"}</span></div>
        <p className="pre">{formatExperience(item)}</p>
        <div className="metaLine"><span>{item.role || "Role TBD"}</span><span>{item.organization || "Organization TBD"}</span></div>
      </article>)}
    </div>
  </DataViewState>;
}

function Portfolio({ items, state }) {
  return <DataViewState state={state} isEmpty={items.length === 0} emptyTitle="No portfolio items found" emptyBody="Imported portfolio items will appear here.">
    <div className="cards">
      {items.map(item => <article className="panel card" key={item.id}>
        <div className="cardTop">
          <div><span className="eyebrow">{item.item_type || "portfolio"}</span><h3>{displayTitle(item, "Untitled portfolio item")}</h3></div>
          <span className="badge">{item.featured ? "Featured" : item.visibility || "private"}</span>
        </div>
        <p>{item.summary || item.body || "No summary recorded."}</p>
        <div className="metaLine"><span>{portfolioYear(item)}</span><span>{item.source_file || "Supabase"}</span>{item.external_url && <span>External Link</span>}</div>
      </article>)}
    </div>
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

function Calendar({ tasks, state }) {
  const month = useMemo(() => buildCalendarMonth(new Date()), []);

  return <DataViewState state={state} isEmpty={tasks.length === 0} emptyTitle="No todos for the calendar" emptyBody="Todos with due dates will appear on the calendar.">
    <section className="panel calendar">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <b className="dow" key={day}>{day}</b>)}
      {month.cells.map((day, index) => day === null
        ? <div className="cal muted" key={`blank-${index}`}/>
        : <div className="cal" key={day}>
          <strong>{day}</strong>
          {tasks.filter(item => todoDate(item) === `${month.yearMonth}-${String(day).padStart(2, "0")}`).map(item => <div className={isDone(item) ? "event done" : "event"} key={item.id}>{displayTitle(item, "Untitled todo")}</div>)}
        </div>)}
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

function Settings({ counts, state, onImportComplete }) {
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
      <SectionTitle title="Supabase Row Counts" sub={state.loadedAt ? `Last refreshed ${state.loadedAt.toLocaleTimeString()}` : "Counts from the current authenticated query"}/>
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

    <ImportExistingData onImportComplete={onImportComplete}/>
  </>;
}

function DataBanner({ state, counts }) {
  if (!state.configured) {
    return <div className="demoBanner error">Supabase is not configured. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.</div>;
  }
  if (state.loading) {
    return <div className="demoBanner">Loading authenticated Supabase data...</div>;
  }
  if (!state.signedIn) {
    return <div className="demoBanner">Sign in under Settings to load your private Supabase workspace data.</div>;
  }
  if (state.error) {
    return <div className="demoBanner error">{state.error}</div>;
  }
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

function StatePanel({ title, body, tone = "neutral" }) {
  return <section className={`panel statePanel ${tone}`}>
    <h3>{title}</h3>
    <p>{body}</p>
  </section>;
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

function TaskRow({ item }) {
  return <div className={isDone(item) ? "task done" : "task"}>
    <span className="check">{isDone(item) ? "✓" : ""}</span>
    <b>{displayTitle(item, "Untitled todo")}</b>
    <small>{todoGroup(item)}</small>
  </div>;
}

function ProgressRow({ label, value, status }) {
  return <div className="progressRow"><div><b>{label}</b><span>{status}</span></div><strong>{value}%</strong><div className="progress"><i style={{ width: `${value}%` }}/></div></div>;
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
  if (mismatch) {
    throw new Error(`${mismatch.table}: loaded ${mismatch.rows.length} rows but Supabase reported ${mismatch.count}.`);
  }

  return loaded.reduce((workspace, result) => ({ ...workspace, [result.key]: result.rows }), emptyWorkspace);
}

async function fetchTodos(userId) {
  try {
    return await fetchRows({
      key: "todos",
      table: TABLES.todos,
      select: DEFAULT_SELECTS.todos,
      orders: [["status", { ascending: true }], ["due_on", { ascending: true, nullsFirst: false }], ["created_at", { ascending: false }]],
      userId
    });
  } catch (error) {
    if (!/todo_date/i.test(error.message)) throw error;
    return fetchRows({
      key: "todos",
      table: TABLES.todos,
      select: DEFAULT_SELECTS.todos.replace(/,?\s*todo_date/g, ""),
      orders: [["status", { ascending: true }], ["due_on", { ascending: true, nullsFirst: false }], ["created_at", { ascending: false }]],
      userId
    });
  }
}

async function fetchRows({ key, table, select, orders, userId }) {
  const pageSize = 1000;
  const rows = [];
  let expectedCount = null;

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from(table)
      .select(select, { count: "exact" })
      .eq("user_id", userId)
      .range(from, from + pageSize - 1);

    for (const [column, options] of orders) {
      query = query.order(column, options);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);

    if (expectedCount === null) expectedCount = count;
    rows.push(...(data || []));

    if ((data || []).length < pageSize || (expectedCount !== null && rows.length >= expectedCount)) break;
  }

  return { key, table, rows, count: expectedCount };
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

function displayTitle(item, fallback) {
  return item.title || item.name || item.raw_data?.title || item.raw_data?.name || fallback;
}

function displayStatus(status) {
  return (status || "unknown").replaceAll("_", " ");
}

function progressValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function isDone(item) {
  return item.status === "done" || Boolean(item.completed_at);
}

function todoDate(item) {
  return item.due_on || item.todo_date || null;
}

function todoGroup(item) {
  return item.metadata?.category || item.raw_data?.category || item.source_file || "Todo";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateRange(start, end) {
  if (start && end) return `${start} to ${end}`;
  return start || end || "No dates recorded";
}

function portfolioYear(item) {
  const year = item.metadata?.year || item.raw_data?.year || (item.published_at ? new Date(item.published_at).getFullYear() : null);
  return year ? String(year) : "Year TBD";
}

function formatExperience(item) {
  const lines = [
    ["S", item.situation],
    ["T", item.task],
    ["A", item.action],
    ["R", item.result],
    ["Reflection", item.reflection]
  ].filter(([, value]) => value);

  if (lines.length === 0) return item.summary || item.raw_data?.body || "No STAR details recorded.";
  return lines.map(([label, value]) => `${label}: ${value}`).join("\n");
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
