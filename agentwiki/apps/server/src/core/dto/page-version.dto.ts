export class PageVersionResponseDto {
  id: string;
  pageId: string;
  title: string;
  content: string;
  authorId: string;
  folderId: string | null;
  path: string | null;
  createdAt: Date;
}

export class PageVersionListResponseDto {
  versions: PageVersionResponseDto[];
}

export class RestoreVersionResponseDto {
  id: string;
  title: string;
  slug: string;
  content: string;
  format: string;
  parentId: string | null;
  folderId: string | null;
  path: string | null;
  spaceId: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}
