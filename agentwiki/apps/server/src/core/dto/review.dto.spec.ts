import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { RevertChangeSetDto } from './review.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe('RevertChangeSetDto', () => {
  it('requires a caller-provided decimal tree revision and rejects unknown fields', async () => {
    await expect(productionPipe.transform({ expectedTreeRevision: '12' }, {
      type: 'body', metatype: RevertChangeSetDto,
    })).resolves.toMatchObject({ expectedTreeRevision: '12' });
    await expect(productionPipe.transform({}, {
      type: 'body', metatype: RevertChangeSetDto,
    })).rejects.toMatchObject({ status: 400 });
    await expect(productionPipe.transform({ expectedTreeRevision: '01' }, {
      type: 'body', metatype: RevertChangeSetDto,
    })).rejects.toMatchObject({ status: 400 });
    await expect(productionPipe.transform({ expectedTreeRevision: 12 }, {
      type: 'body', metatype: RevertChangeSetDto,
    })).rejects.toMatchObject({ status: 400 });
    await expect(productionPipe.transform({ expectedTreeRevision: '12', recursive: true }, {
      type: 'body', metatype: RevertChangeSetDto,
    })).rejects.toMatchObject({ status: 400 });
  });
});
