# Project rules

- Source of truth: docs/INTEGRATION_AUDIT.md (read-only). Progress tracker: docs/PRODUCTION_PLAN.md.
- Work on one phase at a time. Never start a later phase without being asked.
- Never touch production/live databases, never run forge --broadcast, never read or print .env secrets.
- Never run DB migrations against any remote database. Only write SQL files.
- Prefer small commits, one per task. Run typecheck and tests before each commit.
- At the end of each task, update docs/PRODUCTION_PLAN.md (check the box + short notes).
- If something in the audit contradicts the code, trust the code, and note the discrepancy in the plan.
