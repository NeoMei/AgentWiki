import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

interface TemplateCreateShape {
  templateId?: unknown;
  templateVersion?: unknown;
  templateLocale?: unknown;
  content?: unknown;
  format?: unknown;
}

export function IsPageTemplateCreateShape(options?: ValidationOptions) {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isPageTemplateCreateShape',
    target: target.constructor,
    propertyName,
    options,
    validator: {
      validate(_value: unknown, args: ValidationArguments) {
        const body = args.object as TemplateCreateShape;
        const count = [body.templateId, body.templateVersion, body.templateLocale]
          .filter((value) => value !== undefined).length;
        if (count === 0) return true;
        return count === 3
          && body.content === undefined
          && (body.format === undefined || body.format === 'markdown');
      },
      defaultMessage: () => 'templateId, templateVersion, and templateLocale must appear together without content or non-Markdown format',
    },
  });
}
