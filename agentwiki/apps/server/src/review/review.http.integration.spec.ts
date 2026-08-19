import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

describe('ReviewController stale action errors', () => {
  let app: INestApplication;
  let baseUrl: string;

  const prisma = {
    changeSet: {
      findUnique: jest.fn(({ where }: any) => {
        const status = where.id === 'stale-publish' ? 'published'
          : where.id === 'stale-revert' ? 'reverted'
          : where.id === 'draft-publish' ? 'draft'
          : 'pending_review';
        return Promise.resolve({
          id: where.id,
          status,
          spaceId: 'space-1',
          createdByUserId: 'owner-1',
          createdByAgentId: null,
          publishedAt: new Date('2026-08-19T10:00:00Z'),
          items: [],
          approvals: [],
          space: {},
          run: null,
        });
      }),
    },
  } as any;
  const review = new ReviewService(prisma, {} as any, {} as any);
  const authorization = { assertChangeSetAccess: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        { provide: ReviewService, useValue: review },
        { provide: AuthorizationService, useValue: authorization },
      ],
    })
      .overrideGuard(CombinedAuthGuard)
      .useValue({
        canActivate(context: any) {
          context.switchToHttp().getRequest().user = { userId: 'owner-1', type: 'human' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['publish', 'stale-publish'],
    ['revert', 'stale-revert'],
  ])('returns HTTP 409 + CHANGESET_INVALID_STATE for a stale %s', async (action, id) => {
    const response = await fetch(`${baseUrl}/change-sets/${id}/${action}`, { method: 'POST' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 409,
      code: 'CHANGESET_INVALID_STATE',
    });
  });

  it.each(['draft-publish', 'pending-publish'])(
    'returns HTTP 403 + APPROVAL_REQUIRED for an unapproved %s request',
    async (id) => {
      const response = await fetch(`${baseUrl}/change-sets/${id}/publish`, { method: 'POST' });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 403,
        code: 'APPROVAL_REQUIRED',
      });
    },
  );
});
