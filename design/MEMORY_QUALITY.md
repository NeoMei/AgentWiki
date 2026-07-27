# Agent memory use cases and quality gate

Agent memory remains limited to episodic and semantic memory. It is enabled only for these validated product use cases:

1. **Operational recall**: an Agent recalls a prior decision, incident or action from the same Space and explains why it was selected.
2. **Stable knowledge reuse**: repeated episodic memories are consolidated into a semantic memory with preserved source-memory links and a traceable Evidence link when one exists.

## Retrieval contract

Recall combines four independently reported signals:

- lexical token overlap;
- persisted embedding cosine similarity when an embedding provider is configured, with character-trigram fallback;
- actual Space knowledge-graph expansion from query-matching pages to related page titles, compared with memory entities;
- explicit importance.

## Quality gate

- Isolation: 100% of results belong to the requested Space and are either private to the requested Agent or explicitly marked `space` shared.
- Privacy deletion: deleted content, tags, entities, embeddings and source links are removed.
- Synthetic regression set: Recall@3 >= 0.90 and MRR >= 0.80 before changing weights.
- Production shadow set: at least 50 reviewed queries from both use cases before enabling decay or adding another memory tier.
- Any weight/model change must report the old and new Recall@3/MRR and must not reduce either isolation or deletion guarantees.

Time decay is intentionally disabled. `expiresAt` is an explicit retention policy, enforced by hourly archival maintenance.
