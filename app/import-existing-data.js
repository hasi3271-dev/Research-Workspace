"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { buildImportPreview } from "../lib/import-mapper";

const IMPORT_ORDER = [
  ["projects", "projects"],
  ["papers", "papers"],
  ["experiences", "experiences"],
  ["paperFigures", "paper_figures"],
  ["portfolioItems", "portfolio_items"],
  ["notes", "notes"],
  ["todos", "todos"]
];

export default function ImportExistingData() {
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const [result, setResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState(null);

  const hasPreviewRows = useMemo(() => {
    if (!preview) return false;
    return Object.values(preview.counts).some(count => count > 0);
  }, [preview]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data?.user?.email || null);
    });
  }, []);

  async function handleFileChange(event) {
    const selected = Array.from(event.target.files || []);
    const parsed = [];
    const errors = [];

    for (const file of selected) {
      try {
        const text = await file.text();
        parsed.push({ name: file.name, data: JSON.parse(text) });
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    const nextPreview = buildImportPreview(parsed);
    setFiles(parsed);
    setPreview(nextPreview);
    setParseErrors(errors);
    setResult(null);
  }

  async function handleImport() {
    setIsImporting(true);
    setResult(null);

    try {
      if (!supabase) {
        throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      }

      if (!preview || !hasPreviewRows) {
        throw new Error("Select at least one supported JSON file before importing.");
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData?.user) throw new Error("You must be signed in before importing data.");

      const summary = await commitImportPlan(preview, authData.user.id);
      setResult({ ok: true, summary });
    } catch (error) {
      setResult({ ok: false, message: error.message });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSignIn() {
    setAuthMessage(null);
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      if (!authEmail || !authPassword) throw new Error("Enter both email and password.");

      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword
      });
      if (error) throw error;
      setUserEmail(data?.user?.email || authEmail);
      setAuthPassword("");
      setAuthMessage({ ok: true, text: "Signed in. You can now commit the import." });
    } catch (error) {
      setAuthMessage({ ok: false, text: error.message });
    }
  }

  async function handleSignOut() {
    setAuthMessage(null);
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthMessage({ ok: false, text: error.message });
    } else {
      setUserEmail(null);
      setAuthMessage({ ok: true, text: "Signed out." });
    }
  }

  return <section className="panel section importPanel">
    <SectionTitle title="Import Existing Data" sub="planner.json, portfolio.json, research-note.json"/>

    <div className="importControls">
      <input type="file" accept=".json,application/json" multiple onChange={handleFileChange}/>
      <button className="secondary" onClick={handleImport} disabled={!hasPreviewRows || isImporting}>
        {isImporting ? "Importing..." : "Commit Import"}
      </button>
    </div>

    <p className="mutedText">
      Import runs only for the current authenticated Supabase user. Existing rows with the same source key are skipped, not overwritten.
    </p>

    <div className="importAuth">
      <div>
        <span>Signed in as</span>
        <b>{userEmail || "Not signed in"}</b>
      </div>
      {!userEmail ? <>
        <input type="email" placeholder="Email" value={authEmail} onChange={event => setAuthEmail(event.target.value)}/>
        <input type="password" placeholder="Password" value={authPassword} onChange={event => setAuthPassword(event.target.value)}/>
        <button className="secondary" onClick={handleSignIn}>Sign In</button>
      </> : <button className="secondary" onClick={handleSignOut}>Sign Out</button>}
    </div>

    {authMessage && <div className={authMessage.ok ? "importMessages success" : "importMessages error"}>
      <p>{authMessage.text}</p>
    </div>}

    {files.length > 0 && <div className="importFiles">
      {files.map(file => <span key={file.name}>{file.name}</span>)}
    </div>}

    {preview && <div className="importPreview">
      <PreviewStat label="Todos" value={preview.counts.todos}/>
      <PreviewStat label="Portfolio Items" value={preview.counts.portfolioItems}/>
      <PreviewStat label="Papers" value={preview.counts.papers}/>
      <PreviewStat label="Figures" value={preview.counts.figures}/>
      <PreviewStat label="Tasks" value={preview.counts.tasks}/>
      <PreviewStat label="Notes" value={preview.counts.notes}/>
    </div>}

    {(parseErrors.length > 0 || preview?.warnings.length > 0) && <div className="importMessages warn">
      {[...parseErrors, ...(preview?.warnings || [])].map(message => <p key={message}>{message}</p>)}
    </div>}

    {result && <div className={result.ok ? "importMessages success" : "importMessages error"}>
      {result.ok ? <ImportSummary summary={result.summary}/> : <p>{result.message}</p>}
    </div>}
  </section>;
}

function PreviewStat({label, value}) {
  return <div>
    <span>{label}</span>
    <b>{value}</b>
  </div>;
}

function ImportSummary({summary}) {
  return <>
    <p>Import completed. New rows were inserted and existing source keys were skipped.</p>
    <div className="importResultGrid">
      {summary.map(item => <div key={item.table}>
        <span>{item.label}</span>
        <b>{item.inserted}</b>
        <small>{item.skipped} skipped</small>
      </div>)}
    </div>
  </>;
}

function SectionTitle({title, sub}) {
  return <div className="sectionTitle"><div><h3>{title}</h3><p>{sub}</p></div></div>;
}

async function commitImportPlan(preview, userId) {
  const idMaps = {
    projects: new Map(),
    papers: new Map(),
    experiences: new Map(),
    paperFigures: new Map(),
    portfolioItems: new Map()
  };
  const summary = [];

  for (const [entityKey, table] of IMPORT_ORDER) {
    const entities = preview.entities[entityKey] || [];
    if (entities.length === 0) {
      summary.push({ table, label: labelForEntity(entityKey), inserted: 0, skipped: 0 });
      continue;
    }

    const sourceKeys = entities.map(entity => entity.sourceKey);
    const before = await fetchSourceKeyMap(table, userId, sourceKeys);
    const rows = entities
      .filter(entity => !before.has(entity.sourceKey))
      .map(entity => materializeRow(entity, entityKey, userId, idMaps))
      .map(removeUndefinedValues);

    if (rows.length > 0) {
      const { error } = await supabase
        .from(table)
        .upsert(rows, { onConflict: "user_id,source_key", ignoreDuplicates: true });
      if (error) throw error;
    }

    const after = await fetchSourceKeyMap(table, userId, sourceKeys);
    if (idMaps[entityKey]) idMaps[entityKey] = after;

    summary.push({
      table,
      label: labelForEntity(entityKey),
      inserted: Math.max(after.size - before.size, 0),
      skipped: before.size
    });
  }

  return summary;
}

async function fetchSourceKeyMap(table, userId, sourceKeys) {
  const keys = Array.from(new Set(sourceKeys.filter(Boolean)));
  if (keys.length === 0) return new Map();

  const { data, error } = await supabase
    .from(table)
    .select("id,source_key")
    .eq("user_id", userId)
    .in("source_key", keys);

  if (error) throw error;
  return new Map((data || []).map(row => [row.source_key, row.id]));
}

function materializeRow(entity, entityKey, userId, idMaps) {
  const row = { ...entity.row, user_id: userId };
  const links = {
    project_id: idMaps.projects.get(entity.projectSourceKey),
    paper_id: idMaps.papers.get(entity.paperSourceKey),
    paper_figure_id: idMaps.paperFigures.get(entity.paperFigureSourceKey),
    experience_id: idMaps.experiences.get(entity.experienceSourceKey),
    portfolio_item_id: idMaps.portfolioItems.get(entity.portfolioItemSourceKey)
  };

  for (const [column, value] of Object.entries(links)) {
    if (value) row[column] = value;
  }

  if (entityKey === "paperFigures" && !row.paper_id) {
    throw new Error(`Figure "${row.title || row.figure_label}" could not be linked to a paper.`);
  }

  return row;
}

function removeUndefinedValues(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function labelForEntity(entityKey) {
  return {
    projects: "Projects",
    papers: "Papers",
    experiences: "Experiences",
    paperFigures: "Figures",
    portfolioItems: "Portfolio Items",
    notes: "Notes",
    todos: "Todos"
  }[entityKey] || entityKey;
}
