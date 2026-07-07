import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    email: z.email(),
    age: z.number().min(18),
  });
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value for valid input', () => {
    const input = { email: 'user@example.com', age: 30 };
    expect(pipe.transform(input)).toEqual(input);
  });

  it('strips unknown fields not declared in the schema by default', () => {
    const result = pipe.transform({
      email: 'user@example.com',
      age: 30,
      admin: true,
    }) as Record<string, unknown>;

    expect(result).not.toHaveProperty('admin');
  });

  it('throws BadRequestException for invalid input', () => {
    expect(() => pipe.transform({ email: 'not-an-email', age: 30 })).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException carrying the zod issues as its message', () => {
    try {
      pipe.transform({ email: 'not-an-email', age: 10 });
      throw new Error('expected transform to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: unknown[];
      };
      expect(Array.isArray(response.message)).toBe(true);
      expect(response.message.length).toBeGreaterThan(0);
    }
  });

  it('throws for missing required fields', () => {
    expect(() => pipe.transform({})).toThrow(BadRequestException);
  });
});
