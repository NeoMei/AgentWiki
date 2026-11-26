import { exceedsPageContentLimit } from '@agentwiki/shared';
import { registerDecorator } from 'class-validator';

export function IsPageContentSize() {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isPageContentSize',
    target: target.constructor,
    propertyName,
    validator: {
      validate(value: unknown) {
        return typeof value === 'string' && !exceedsPageContentLimit(value);
      },
      defaultMessage: () => 'content must not exceed 10 MiB in UTF-8',
    },
  });
}
