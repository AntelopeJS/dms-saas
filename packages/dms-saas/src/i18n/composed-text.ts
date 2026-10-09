import type {
  CellTone,
  ComposedText,
  ComposedTextDateFormat,
  ComposedTextDateParam,
  ComposedTextMoneyParam,
  ComposedTextParam,
  ComposedTextRelativeDateParam,
  Tone,
} from "@antelopejs/interface-dms/base";

/**
 * Builders of the texts a route answers for the browser to write in the
 * reader's language: the i18n key and the raw values, never a finished
 * sentence (see `ComposedText`).
 */

/** Joins two texts: `"{first} · {rest}"`, nested for longer lists. */
const DOT_LIST_KEY = "saas.text.dot_list";
/** Joins two amounts: `"{first} + {rest}"`, nested for longer lists. */
const SUM_LIST_KEY = "saas.text.sum_list";
/** A lone value standing as a whole text: `"{value}"`. */
const VALUE_KEY = "saas.text.value";

/** A text of `key`, with the values its message names. */
export function composed(
  key: string,
  params?: Record<string, ComposedTextParam>,
): ComposedText {
  return params ? { key, params } : { key };
}

/** An amount in minor units of `currency`. */
export function moneyParam(
  valueMinor: number,
  currency: string,
): ComposedTextMoneyParam {
  return { type: "money", value: valueMinor, currency: currency.toUpperCase() };
}

/** A day, `medium` ("Oct 10, 2026") unless another format is asked. */
export function dateParam(
  date: Date | string,
  format: ComposedTextDateFormat = "medium",
): ComposedTextDateParam {
  return { type: "date", value: new Date(date).toISOString(), format };
}

/** The distance from now when the text is drawn ("2 hours ago"). */
export function relativeParam(
  date: Date | string,
): ComposedTextRelativeDateParam {
  return { type: "relative", value: new Date(date).toISOString() };
}

/** A count, which also picks the plural form of its message. */
export function countParam(value: number) {
  return { type: "count", value } as const;
}

/** A single value standing as a text of its own: an amount, a date. */
export function valueText(value: ComposedTextParam): ComposedText {
  return composed(VALUE_KEY, { value });
}

function joinWith(
  key: string,
  parts: readonly ComposedTextParam[],
): ComposedTextParam | null {
  const [first, ...rest] = parts;
  if (first === undefined) return null;
  const tail = joinWith(key, rest);
  return tail === null ? first : composed(key, { first, rest: tail });
}

/** Texts listed with " · " between them; null for none. */
export function dotList(
  parts: readonly ComposedTextParam[],
): ComposedText | null {
  const joined = joinWith(DOT_LIST_KEY, parts);
  return joined === null ? null : asText(joined);
}

/** Amounts added with " + " between them; null for none. */
export function sumList(
  parts: readonly ComposedTextParam[],
): ComposedText | null {
  const joined = joinWith(SUM_LIST_KEY, parts);
  return joined === null ? null : asText(joined);
}

function isComposedText(value: ComposedTextParam): value is ComposedText {
  return typeof value === "object" && "key" in value;
}

/** A parameter as a text: a nested text as is, any other value wrapped. */
export function asText(value: ComposedTextParam): ComposedText {
  return isComposedText(value) ? value : valueText(value);
}

// Block tones a status uses, as the text tones a table cell line takes: the
// neutral status reads muted, as the other secondary lines of the cell.
const CELL_TONES: Record<Tone, CellTone> = {
  neutral: "muted",
  primary: "primary",
  secondary: "muted",
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
};

/** The text tone of a cell line drawn in a status's tone. */
export function cellToneOf(tone: Tone): CellTone {
  return CELL_TONES[tone];
}
