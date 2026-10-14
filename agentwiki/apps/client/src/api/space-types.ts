export type SpaceApprovalPolicy = 'always-review' | 'no-review' | 'scoped-auto-publish';
export type CanonicalSpaceApprovalPolicy = Exclude<SpaceApprovalPolicy, 'scoped-auto-publish'>;

/** Normalize persisted policy values while keeping legacy API responses readable. */
export const normalizeSpaceApprovalPolicy = (value: unknown): CanonicalSpaceApprovalPolicy => (
  value === 'no-review' || value === 'scoped-auto-publish' ? 'no-review' : 'always-review'
);

export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
  visibility?: string;
  approvalPolicy?: SpaceApprovalPolicy;
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
