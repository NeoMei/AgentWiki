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

**Derived Knowledge**:
Locally generated, provenance-carrying content that may enter an AgentWiki Preview and synchronization flow.
_Avoid_: Raw source, scan index

**Source Adapter**:
A local boundary that converts organized source material into AgentWiki artifacts without uploading or publishing it directly.
_Avoid_: Scanner, publisher
