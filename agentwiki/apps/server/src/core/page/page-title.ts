import { BadRequestException } from '@nestjs/common';

export const NON_BLANK_PAGE_TITLE = /\S/u;

/** Validate only new titles and explicit renames; never rewrite historical titles. */
export function assertPageTitle(title: unknown): asserts title is string {
  if (typeof title !== 'string' || !NON_BLANK_PAGE_TITLE.test(title)) {
    throw new BadRequestException('Page title must contain a non-whitespace character');
  }
}
