# Agent-Figma-UI-agent

Claude Code agent that reads a Figma file's libraries, components and variables and extends native, editable Figma UI from them.

- Spec (single source of truth): `FIGMA_UI_AGENT_SPEC.md` v1.8. Research and evidence: `FIGMA_MCP_RESEARCH.md`. Current build instructions: `CC_BUILD_PROMPT.md` (M0–M4 history in `docs/history/`).
- Entry point: the manual skill `/figma-ui` (`.claude/skills/figma-ui/SKILL.md`): `/figma-ui <request>`, `/figma-ui continue <run-id> <change>`, `/figma-ui resume <run-id>`.
- Hooks in `.claude/settings.json` guard every Figma write while a run is active. Never bypass them; release the run with `node scripts/state-store.mjs release <run-id>` when done.
- Run artifacts live in `design-runs/<run-id>/` and local state in `.figma-ui/` (both gitignored). Complete examples: `tests/fixtures/m1-run/`.
- Memory layers (spec §4.6): general rules (spec, skill, this file) · product policies in `product-policies/<product>.json` (URLs only in gitignored `.figma-ui/products/`) · per-run memory in `design-runs/<run-id>/` · local runtime state in `.figma-ui/`. Change product policies only after the user answers or confirms (spec §7.5); never write run decisions or product policies into Claude Code memory or this file.
- Talk to the user in Traditional Chinese (questions, progress, handoff); keep technical names, IDs and commands as-is (spec ASK-08). During `/figma-ui`, use only the skills allowed in spec §4.7.
- Useful scripts: `scripts/run-context.mjs` (what a new/continue/resume run still needs to ask), `scripts/validate-artifacts.mjs <runDir> --stage intake|plan|build|final`, `scripts/evaluate-completion.mjs` (the single final judgement), `scripts/run-report.mjs` (phase/question records, metrics, generated handoff).
- Setup: `npm install` (Node 22+). Tests: `node --test "tests/**/*.test.mjs"` (`node --test tests/` fails on Node 22).
- Real Figma writes only in the authorized test area (sandbox page of the test file) after the user confirms the plan.
