export const SPACE_NAME_MAX_LENGTH = 32;

export interface User {
  id: string;
  email: string;
  name: string;
  platformRole?: 'user' | 'super_admin';
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
}

export interface Space {
  id: string;
  name: string;
  workspaceId: string;
}

export interface Page {
  id: string;
  title: string;
  content: string;
  spaceId: string;
}
