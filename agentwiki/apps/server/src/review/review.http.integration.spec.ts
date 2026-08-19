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
      findUnique: jest.fn(({ where }: any) => Promise.resolve({
        id: where.id,
        status: where.id === 'stale-publish' ? 'published' : 'reverted',
        spaceId: 'space-1',
        createdByUserId: 'owner-1',
        createdByAgentId: null,
        publishedAt: new Date('2026-08-19T10:00:00Z'),
        items: [],
        approvals: [],
        space: {},
        run: null,
      })),
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
});
