export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
  visibility?: string;
  approvalPolicy?: string;
  members?: Array<{
    type?: string;
    role?: string;
    user?: { id: string; name?: string | null; email?: string } | null;
  }>;
  _count?: {
    pages?: number;
  };
  // Keep these optional so the card can consume richer list responses later
  // without coupling the dashboard to a second request per Space.
  pageCount?: number;
  memberCount?: number;
  agentCount?: number;
}

export interface SpaceListResponse {
  data: SpaceSummary[];
  total: number;
  page: number;
  limit: number;
  revision: string;
  nextCursor: string | null;
  hasMore: boolean;
  resetRequired: boolean;
}
