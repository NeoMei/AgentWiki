# AgentWiki

AgentWiki turns locally organized knowledge into reviewable, versioned Space knowledge without making the server responsible for reading a user's local sources.

## Language

**Scanner**:
An independently operated local tool that indexes and extracts structure from a code source. CodeGraph is the current scanner.
_Avoid_: Adapter, analyzer

**Scan Index**:
Scanner-owned local data used to answer structural code queries. It is not shareable AgentWiki knowledge.
_Avoid_: Snapshot, knowledge bundle

**Code Snapshot**:
AgentWiki's scanner-independent normalized record of structural code facts used as analysis input.
_Avoid_: CodeGraph database, raw scan result

**Base Analysis**:
Deterministic derived knowledge produced by a standard code scan.
_Avoid_: Quick analysis, shallow scan

**Deep Analysis**:
User-requested derived knowledge that adds module relationships and optional local Agent explanations.
_Avoid_: Automatic analysis, default scan

**Scan Plan Consent**:
Current, explicit consent for an exact read-only CodeGraph plan and its `localScanPlanHash`. It permits only the matching local scanner action.
_Avoid_: Persistent consent, sync consent

**Preview Sync Consent**:
Separate, current approval to upload one exact AgentWiki Preview after its additions, updates, and deletions are shown.
_Avoid_: Scan consent, implied upload

**Derived Knowledge**:
Locally generated, provenance-carrying content that may enter an AgentWiki Preview and synchronization flow.
_Avoid_: Raw source, scan index

**Source Adapter**:
A local boundary that converts organized source material into AgentWiki artifacts without uploading or publishing it directly.
_Avoid_: Scanner, publisher

### Agent Collaboration

**Collaboration Template**:
A reusable, versioned blueprint of Role Slots, workflow nodes, Task Todos, dependencies, inputs, and expected Task Artifacts.
_Avoid_: Recipe, workflow definition

**Collaboration Component**:
A user-facing building block for composing a Collaboration Template. A component resolves to a task node, Human Review Gate, dependency, or Task Todo rather than becoming a separately executable object by default.
_Avoid_: Plugin, widget

**Role Slot**:
A named responsibility in a Collaboration Template that is bound to a concrete Agent when a Collaboration Run starts.
_Avoid_: Agent, fixed assignee

**Collaboration Run**:
A Space-scoped execution created from an immutable Collaboration Template snapshot and concrete Role Bindings.
_Avoid_: Job, workflow template

**Role Binding**:
The mapping from one Role Slot to a concrete Agent for a Collaboration Run.
_Avoid_: Agent Grant, task assignment

**Run Task**:
The only Agent-claimable unit in a Collaboration Run, owned by one primary Agent at a time.
_Avoid_: Step, Assist Task, Work Item

**Task Todo**:
An ordered, non-claimable checklist item within a Run Task. It shares the Run Task's primary Agent and cannot declare independent dependencies.
_Avoid_: Subtask, workflow step

**Task Dependency**:
A precedence relationship that keeps a downstream node blocked until its required upstream nodes are accepted. Parallelism emerges when multiple nodes are ready at the same time.
_Avoid_: Parallel component, handoff task

**Task Artifact**:
A versioned result submitted by a Run Task as Markdown, structured data, or a reference to an externally created file or code change.
_Avoid_: Source Artifact, untracked output

**Human Review Gate**:
A workflow node that only an authorized human member may approve, reject for revision, or use to terminate a Collaboration Run.
_Avoid_: Reviewer Agent, automatic approval
