import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { PageNoteModule } from './page-note.module';
import { PageNoteService } from './page-note.service';

describe('aggregate note discovery HTTP route', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PageNoteModule);
    const module = await Test.createTestingModule({
      controllers,
      providers: [{ provide: PageNoteService, useValue: {
        discover: async (principal: { userId: string }, query: { spaceId: string }) => ({
          notes: [{ author: principal.userId, spaceId: query.spaceId }], total: 1, nextCursor: null,
        }),
      } }],
    }).overrideGuard(CombinedAuthGuard).useValue({ canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = { userId: 'reader' }; return true;
    } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });
  it('exposes the aggregate GET route separately from page-scoped CRUD', async () => {
    const response = await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/api/page-notes?spaceId=one`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: [{ author: 'reader', spaceId: 'one' }], total: 1, nextCursor: null });
  });
});
