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
  assert.equal(todo.priority, 1);
  assert.equal(todo.status, "done");
  assert.equal(todo.metadata.category, "Research");
  assert.equal(todo.metadata.original_id, "todo-1");
  assert.equal(todo.raw_data.unexpectedField, "keep me");
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
                  tasks: [{ id: "paper-task-1", title: "Check reviewer comments" }],
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
