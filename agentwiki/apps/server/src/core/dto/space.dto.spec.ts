import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateSpaceDto, UpdateSpaceDto } from './space.dto';

const pipe = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe.each([CreateSpaceDto, UpdateSpaceDto])('%p Space name contract', (metatype) => {
  const parse = (body: object) => pipe.transform(body, { type: 'body', metatype });

  it.each(['a', '空', '😀', '✈️'])('accepts 32 and rejects 33 units of %s', async (unit) => {
    await expect(parse({ name: unit.repeat(32) })).resolves.toMatchObject({ name: unit.repeat(32) });
    await expect(parse({ name: unit.repeat(33) })).rejects.toMatchObject({ status: 400 });
  });

  it('trims before validating and returns the normalized name', async () => {
    await expect(parse({ name: `  ${'空'.repeat(32)}  ` })).resolves.toMatchObject({ name: '空'.repeat(32) });
  });

  it.each(['', ' \t\n ', null, 123, true, [], {}])('rejects blank or non-string name %p', async (name) => {
    await expect(parse({ name })).rejects.toMatchObject({ status: 400 });
  });
});

it('allows settings-only updates without a name, but requires a name for creation', async () => {
  const body = { description: 'Changed description' };
  await expect(pipe.transform(body, { type: 'body', metatype: UpdateSpaceDto })).resolves.toMatchObject(body);
  await expect(pipe.transform(body, { type: 'body', metatype: CreateSpaceDto })).rejects.toMatchObject({ status: 400 });
});
