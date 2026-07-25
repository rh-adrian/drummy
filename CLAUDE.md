# AI Drummer — Agent Instructions

Open-source AI drummer: LLM agent + MCP server + sample-triggering sequencer engine.
Read `README.md` for the vision and `RESEARCH.md` for the landscape analysis and
architecture decisions before making changes.

## Project rules

- **Keep README.md and RESEARCH.md living documents** — update them alongside any
  code or design change. If a decision in RESEARCH.md is overturned (e.g., we drop
  Strudel for a self-contained engine), record the new decision and the reason in place.
- Symbolic-pattern approach is a settled decision (vs. neural audio generation) —
  see RESEARCH.md §2. Don't re-litigate without new evidence.
- The pattern schema must always carry per-hit velocity and micro-timing offsets.
  Any engine or tool-surface change that drops them is a regression.
- Real-time is explicitly NOT a requirement. Bar-boundary hot-swap (~2–4 s) is the target.
- All bundled samples must be open-licensed; record source + license for every kit
  in a `SAMPLES.md` (create it when the first samples land).
