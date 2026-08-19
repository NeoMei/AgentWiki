export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt?: string;
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
