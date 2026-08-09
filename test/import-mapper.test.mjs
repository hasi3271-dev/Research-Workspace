import assert from "node:assert/strict";
import test from "node:test";
import { buildImportPreview } from "../lib/import-mapper.js";

test("maps planner items to todos and preserves raw fields", () => {
  const preview = buildImportPreview([
    {
      name: "planner.json",
      data: {
        items: [
          {
            id: "todo-1",
            title: "Revise Figure 4",
            category: "Research",
            dueDate: "2026-08-09",
            priority: "high",
            done: true,
            unexpectedField: "keep me"
          }
        ]
      }
    }
  ]);

  assert.equal(preview.counts.todos, 1);
  const todo = preview.entities.todos[0].row;
  assert.equal(todo.title, "Revise Figure 4");
  assert.equal(todo.due_on, "2026-08-09");
  assert.equal(todo.todo_date, "2026-08-09");
  assert.equal(todo.priority, 1);
  assert.equal(todo.status, "done");
  assert.equal(todo.metadata.category, "Research");
  assert.equal(todo.metadata.original_id, "todo-1");
  assert.equal(todo.raw_data.unexpectedField, "keep me");
});

test("sets a non-null legacy todo_date default when due date is missing", () => {
  const preview = buildImportPreview([
    {
      name: "planner.json",
      data: [{ id: "todo-without-date", title: "No due date" }]
    }
  ]);

  const todo = preview.entities.todos[0].row;
  assert.equal(todo.due_on, null);
  assert.equal(todo.todo_date, "1970-01-01");
});

test("maps Korean priorities while preserving original labels", () => {
  const preview = buildImportPreview([
    {
      name: "planner.json",
      data: [
        { id: "high", title: "High", priority: "높음" },
        { id: "normal", title: "Normal", priority: "보통" },
        { id: "low", title: "Low", priority: "낮음" }
      ]
    }
  ]);

  assert.deepEqual(preview.entities.todos.map(todo => todo.row.priority), [1, 3, 5]);
  assert.deepEqual(preview.entities.todos.map(todo => todo.row.metadata.original_priority), ["높음", "보통", "낮음"]);
});

test("maps portfolio papers, figures, paper tasks, and year items", () => {
  const preview = buildImportPreview([
    {
      name: "portfolio.json",
      data: {
        years: {
          2026: [
            {
              id: "portfolio-1",
              title: "Hydrogen alloy screening",
              role: "Researcher",
              skills: ["DFT", "VASP"],
              project: "Hydrogen Storage",
              papers: [
                {
                  id: "paper-1",
                  title: "Alloy screening manuscript",
                  status: "manuscript",
                  tasks: [{ id: "paper-task-1", title: "Check reviewer comments", linked: "Figure 4", priority: "보통" }],
                  figures: [
                    {
                      id: "fig-4",
                      label: "Figure 4",
                      title: "Candidate ranking",
                      claim: "A-site composition controls performance",
                      data: { source: "screening.csv" },
                      status: "needs_revision",
                      next: "Update annotations",
                      reference: "SI Table 2",
                      caption: "Ranking of candidates"
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ]);

  assert.equal(preview.counts.portfolioItems, 1);
  assert.equal(preview.counts.papers, 1);
  assert.equal(preview.counts.figures, 1);
  assert.equal(preview.counts.tasks, 1);
  assert.equal(preview.counts.todos, 1);
  assert.equal(preview.counts.projects, 1);
  assert.equal(preview.counts.experiences, 1);
  assert.equal(preview.entities.projects[0].row.title, "Hydrogen Storage");

  const figure = preview.entities.paperFigures[0].row;
  assert.equal(figure.figure_label, "Figure 4");
  assert.equal(figure.title, "Candidate ranking");
  assert.equal(figure.caption, "Ranking of candidates");
  assert.equal(figure.status, "needs_revision");
  assert.equal(figure.metadata.claim, "A-site composition controls performance");
  assert.deepEqual(figure.metadata.data, { source: "screening.csv" });
  assert.equal(figure.metadata.next, "Update annotations");
  assert.equal(figure.metadata.reference, "SI Table 2");
  assert.equal(figure.raw_data.reference, "SI Table 2");

  const task = preview.entities.todos[0];
  assert.equal(task.paperFigureSourceKey, "portfolio:figure:fig-4");
  assert.equal(task.row.priority, 3);
});

test("maps research-note.json to notes", () => {
  const preview = buildImportPreview([
    {
      name: "research-note.json",
      data: {
        notes: [
          {
            id: "note-1",
            title: "CNT discussion",
            body: "Connect adsorption and mobility.",
            tags: ["paper", "discussion"],
            unknown: { nested: true }
          }
        ]
      }
    }
  ]);

  assert.equal(preview.counts.notes, 1);
  const note = preview.entities.notes[0].row;
  assert.equal(note.title, "CNT discussion");
  assert.equal(note.body, "Connect adsorption and mobility.");
  assert.deepEqual(note.tags, ["paper", "discussion"]);
  assert.deepEqual(note.raw_data.unknown, { nested: true });
});

test("maps research-note workspace exports to notes and preserves nested paper data", () => {
  const preview = buildImportPreview([
    {
      name: "research-note.json",
      data: {
        portfolio: {
          2026: [
            {
              id: "pf-mlip-workflow",
              category: "연구 프로젝트",
              title: "NYZC MLIP workflow",
              status: "진행 중",
              summary: "Workflow note",
              evidence: "E/F/S error"
            }
          ]
        },
        papers: [
          {
            id: "nyzc",
            title: "Na paper",
            year: 2026,
            stage: "Figure set",
            summary: "Paper note",
            figures: [{ id: "fig-1", label: "Fig.1", title: "Figure one", claim: "Claim" }],
            tasks: [{ id: "task-1", title: "Check Fig.1", linked: "Fig.1", priority: "높음" }],
            references: [{ id: "ref-1", title: "Reference", doi: "10/example" }],
            logs: [{ id: "log-1", date: "2026-07-28", text: "Log entry" }]
          }
        ]
      }
    }
  ]);

  assert.equal(preview.counts.notes, 6);
  assert.equal(preview.counts.projects, 2);
  assert.equal(preview.counts.papers, 1);
  assert.equal(preview.counts.figures, 1);
  assert.equal(preview.entities.notes.some(note => note.paperFigureSourceKey === "research-note:figure:fig-1"), true);
});

test("deduplicates repeated source keys during preview", () => {
  const file = {
    name: "planner.json",
    data: {
      items: [
        { id: "todo-1", title: "One" },
        { id: "todo-1", title: "One again" }
      ]
    }
  };

  const preview = buildImportPreview([file]);

  assert.equal(preview.counts.todos, 1);
  assert.equal(preview.warnings.length, 1);
});
