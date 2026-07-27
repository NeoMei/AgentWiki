-- AgentWiki 数据库 Schema
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_hash VARCHAR(255) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{"pages": "read", "wiki": "read", "graph": "read"}',
    scope JSONB NOT NULL DEFAULT '{"spaces": ["*"], "pages": ["*"]}',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    memory_enabled BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE knowledge_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    edge_type VARCHAR(50) NOT NULL,
    weight FLOAT DEFAULT 1.0,
    confidence FLOAT DEFAULT 1.0,
    evidence TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_by_agent UUID REFERENCES agents(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_id, target_id, edge_type)
);

CREATE TABLE agent_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    memory_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    source_page_ids UUID[] DEFAULT '{}',
    importance INT DEFAULT 3,
    access_count INT DEFAULT 0,
    effective_importance FLOAT DEFAULT 1.0,
    entities TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    embedding VECTOR(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE ingest_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(50) NOT NULL,
    source_url TEXT,
    raw_content TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    compiled_page_ids UUID[] DEFAULT '{}',
    approval_status VARCHAR(20) DEFAULT 'auto',
    approved_by UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_by_agent UUID REFERENCES agents(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);