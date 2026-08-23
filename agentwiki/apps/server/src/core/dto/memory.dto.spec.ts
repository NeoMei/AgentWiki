import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConsolidateMemoryDto, CreateMemoryDto } from './memory.dto';

describe('memory DTO bounds', () => {
  it('rejects an unbounded tag list and non-object entities', async () => {
    const dto = plainToInstance(CreateMemoryDto, {
      spaceId: 'space-1',
      type: 'semantic',
      content: 'memory',
      tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`),
      entities: ['not', 'an', 'object'],
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['tags', 'entities']));
  });

  it('rejects consolidation requests with more than 100 memory ids', async () => {
    const dto = plainToInstance(ConsolidateMemoryDto, {
      spaceId: 'space-1',
      memoryIds: Array.from({ length: 101 }, (_, index) => `memory-${index}`),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('memoryIds');
  });
});
