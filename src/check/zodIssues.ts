import { z } from 'zod';
import { closest, formatPath, type Diagnostic } from './diagnostic.ts';

/** Turns zod issues into diagnostics that name the valid options and a fix. */
export function issuesToDiagnostics(schema: z.ZodType, issues: readonly z.core.$ZodIssue[]): Diagnostic[] {
  return issues.flatMap((issue): Diagnostic[] => {
    const path = formatPath(issue.path);
    switch (issue.code) {
      case 'unrecognized_keys': {
        const allowed = keysAt(schema, issue.path);
        return issue.keys.map((key) => {
          const guess = closest(key, allowed);
          return {
            level: 'error',
            path: path ? `${path}.${key}` : key,
            message: `"${key}" is not a field here. Valid fields: ${allowed.map((k) => `"${k}"`).join(', ')}.`,
            fix: guess ? `rename "${key}" to "${guess}".` : `remove "${key}".`,
          };
        });
      }
      case 'invalid_value': {
        const options = issue.values.map((v) => JSON.stringify(v));
        return [{ level: 'error', path, message: `Must be one of ${options.join(', ')}.`, fix: `use one of ${options.join(', ')}.` }];
      }
      case 'invalid_type': {
        const missing = issue.message.includes('received undefined');
        return [
          {
            level: 'error',
            path,
            message: missing ? `Required field is missing (expected ${issue.expected}).` : issue.message,
            fix: missing ? `add "${String(issue.path.at(-1))}".` : undefined,
          },
        ];
      }
      default:
        return [{ level: 'error', path, message: issue.message }];
    }
  });
}

/** The field names an object schema accepts at a JSON path. */
function keysAt(schema: z.ZodType, path: readonly PropertyKey[]): string[] {
  let node: unknown = schema;
  for (const key of path) {
    node = unwrap(node);
    if (node instanceof z.ZodArray) node = node.element;
    else if (node instanceof z.ZodRecord) node = node.valueType;
    else if (node instanceof z.ZodObject) node = (node.shape as Record<string, unknown>)[String(key)];
    else return [];
  }
  node = unwrap(node);
  return node instanceof z.ZodObject ? Object.keys(node.shape) : [];
}

function unwrap(node: unknown): unknown {
  while (node instanceof z.ZodOptional || node instanceof z.ZodDefault || node instanceof z.ZodNullable) {
    node = node.unwrap();
  }
  return node;
}
