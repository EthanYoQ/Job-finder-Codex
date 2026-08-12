# Issue tracker: Local Markdown

Issues and specs (including PRDs) for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history are appended under an `## Comments` heading

## Publishing an issue

Create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

## Fetching a ticket

Read the referenced ticket file directly.

## Blocking relationships

Each ticket may contain:

- `Blocked by: NN, NN`
- `Status: open`
- `Status: claimed`
- `Status: resolved`

A ticket is ready only when all listed blockers are resolved. Work proceeds blockers-first.
