import type { HTTPBody } from "@antelopejs/interface-api";
import type { ZodIssue } from "zod";

function isJson(value: unknown): value is HTTPBody {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value).every(isJson);
}

/**
 * zod's issues as the JSON value `JSON.stringify` writes for them, so a body
 * holding it serializes byte for byte as one holding the issues. A `ZodError`
 * nested in an issue (`unionErrors`, `argumentsError`, `returnTypeError`)
 * becomes its enumerable fields, `issues` and `name`.
 */
export function zodIssuesJson(issues: readonly ZodIssue[]): HTTPBody {
  const json: unknown = JSON.parse(JSON.stringify(issues));
  if (!isJson(json))
    throw new TypeError("zod issues did not serialize to JSON");
  return json;
}
