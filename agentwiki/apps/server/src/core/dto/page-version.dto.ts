export class PageVersionResponseDto {
  id: string;
  pageId: string;
  title: string;
  content: string;
  authorId: string;
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
  spaceId: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}
