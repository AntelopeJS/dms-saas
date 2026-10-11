/**
 * The base language of a BCP 47 tag, lowercase: `fr` for `fr-FR`; undefined
 * for no language.
 */
export function baseLanguage(
  language: string | null | undefined,
): string | undefined {
  return language?.split("-")[0]?.trim().toLowerCase() || undefined;
}
