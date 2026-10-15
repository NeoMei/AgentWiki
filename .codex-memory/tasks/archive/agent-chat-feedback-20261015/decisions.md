# Decisions
- Base v0.12.34 / 479419ef; preserve latest session-tab closing and released editor behavior.
- Process feedback is event-driven phase + attempt + active elapsed time; OpenCode CLI 1.18.12 only emits completed text parts, so this does not claim token streaming.
- Keep validated answer progress separate from execution phase. Store bounded progress temporarily in existing AssistTask.result JSON while active; public DTO whitelist and terminal clearing/hiding avoid schema change.
- Collapse optional diff/detail/download in compact chat review. Keep main acceptance, discard, version/conflict/truncation/permission warnings accessible. No change to draft-vs-Save/direct mode semantics.
- Implement server then frontend with separate fresh agents, independently review each and integrated diff. Use synthetic fixture only for browser writes.
