import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreatePageDto } from './page.dto';

describe('IsPageTemplateCreateShape', () => {
  it.each([
    [{ title: 'Blank', spaceId: 'space-1' }, true],
    [{ title: 'Only id', spaceId: 'space-1', templateId: 'template-1' }, false],
    [{ title: 'Id and version', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2 }, false],
    [{ title: 'Version and locale only', spaceId: 'space-1', templateVersion: 2, templateLocale: 'en' }, false],
    [{ title: 'All fields', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN' }, true],
    [{ title: 'Mixed', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged' }, false],
    [{ title: 'Wrong format', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html' }, false],
  ])('validates template-field completeness and content exclusivity %#', async (input, valid) => {
    const errors = await validate(Object.assign(new CreatePageDto(), input));
    expect(errors.length === 0).toBe(valid);
  });
});
