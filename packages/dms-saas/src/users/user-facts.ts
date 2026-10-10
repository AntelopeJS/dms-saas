import type {
  ComposedText,
  ComposedTextParam,
  KeyValueListItem,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import {
  composed,
  countParam,
  dateParam,
  dotList,
  moneyParam,
  relativeParam,
  sumList,
  valueText,
} from "../i18n/composed-text";
import type { MoneyTotal, UserDetail, UserSecurity } from "./user-detail";

const FACTS = "saas.users.detail_facts";
const SECURITY = "saas.users.security";
const DETAIL_SEPARATOR = " · ";
const LOCATION_SEPARATOR = ", ";
// The languages the dashboard ships, named in the reader's language by the
// catalogues; any other code is shown as stored.
const NAMED_LANGUAGES = new Set(["en", "fr"]);
const NAMED_SIGN_IN_METHODS = new Set(["password"]);
const NAMED_TWO_FACTOR_METHODS = new Set(["totp", "email"]);

function languageName(code: string | null): ComposedText | string {
  if (!code) return `$${FACTS}.no_language`;
  const language = code.split("-")[0]!.toLowerCase();
  return NAMED_LANGUAGES.has(language)
    ? composed(`${FACTS}.languages.${language}`)
    : code;
}

function billedText(
  totals: readonly MoneyTotal[],
  fallbackCurrency: string,
): ComposedText {
  if (totals.length === 0) return valueText(moneyParam(0, fallbackCurrency));
  return sumList(
    totals.map((total) => moneyParam(total.amount, total.currency)),
  )!;
}

function lastActiveDetail(user: UserDetail): string | undefined {
  const session = user.lastSession;
  if (!session) return undefined;
  return (
    [session.browser, session.location]
      .filter(Boolean)
      .join(DETAIL_SEPARATOR) || undefined
  );
}

/**
 * The figures under a user's header: workspaces, language, last activity,
 * creation and what they were billed as an owner.
 *
 * @param user The user
 * @param fallbackCurrency Currency a zero total is written in
 */
export function userFactItems(
  user: UserDetail,
  fallbackCurrency: string,
): StatGroupItem[] {
  const owned = user.workspaces.filter((workspace) => workspace.isTenantOwner);
  return [
    {
      id: "workspaces",
      icon: "i-ph-buildings",
      eyebrow: `$${FACTS}.workspaces`,
      value: user.workspaces.length,
      detail: composed(`${FACTS}.workspaces_detail`, {
        owned: owned.length,
        member: user.workspaces.length - owned.length,
      }),
    },
    {
      id: "language",
      icon: "i-ph-translate",
      eyebrow: `$${FACTS}.language`,
      value: languageName(user.language),
      detail: user.language ?? undefined,
    },
    {
      id: "last-active",
      icon: "i-ph-clock",
      eyebrow: `$${FACTS}.last_active`,
      value: user.lastActiveAt
        ? valueText(relativeParam(user.lastActiveAt))
        : "$saas.users.never_active",
      detail: lastActiveDetail(user),
    },
    {
      id: "created",
      icon: "i-ph-calendar-blank",
      eyebrow: `$${FACTS}.created`,
      value: valueText(dateParam(user.createdAt)),
      detail: valueText(relativeParam(user.createdAt)),
    },
    {
      id: "billed",
      icon: "i-ph-coins",
      eyebrow: `$${FACTS}.billed`,
      value: billedText(user.billedAsOwner, fallbackCurrency),
      detail: composed(`${FACTS}.billed_detail`, {
        count: countParam(owned.length),
      }),
    },
  ];
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function methodLabel(method: string): ComposedTextParam {
  return NAMED_SIGN_IN_METHODS.has(method)
    ? composed(`${SECURITY}.method.${method}`)
    : capitalised(method);
}

function twoFactorLabel(method: string): ComposedTextParam {
  return NAMED_TWO_FACTOR_METHODS.has(method)
    ? composed(`${SECURITY}.two_factor_method.${method}`)
    : method;
}

function twoFactorItem(security: UserSecurity): KeyValueListItem {
  const methods = dotList(security.twoFactorMethods.map(twoFactorLabel));
  if (!methods) {
    return {
      id: "two-factor",
      label: `$${SECURITY}.two_factor`,
      value: `$${SECURITY}.off`,
      tone: "warning",
    };
  }
  return {
    id: "two-factor",
    label: `$${SECURITY}.two_factor`,
    value: methods,
    detail:
      security.backupCodesLeft === null
        ? undefined
        : composed(`${SECURITY}.backup_codes_left`, {
            count: countParam(security.backupCodesLeft),
          }),
  };
}

function verificationItem(security: UserSecurity): KeyValueListItem {
  const isVerified = security.isEmailVerified;
  return {
    id: "email-verified",
    label: `$${SECURITY}.email_verified`,
    type: "status",
    value: isVerified ? `$${SECURITY}.yes` : `$${SECURITY}.not_yet`,
    tone: isVerified ? "success" : "warning",
    detail:
      !isVerified && security.verificationRequestedAt
        ? composed(`${SECURITY}.verification_requested`, {
            date: dateParam(security.verificationRequestedAt),
          })
        : undefined,
  };
}

/**
 * How a user signs in, as label / value rows: methods, second factor,
 * sessions and whether the address is verified.
 *
 * @param security The user's sign-in facts
 */
export function userSecurityItems(security: UserSecurity): KeyValueListItem[] {
  return [
    {
      id: "sign-in",
      label: `$${SECURITY}.sign_in_methods`,
      value:
        dotList(security.signInMethods.map(methodLabel)) ??
        `$${SECURITY}.no_method`,
    },
    twoFactorItem(security),
    {
      id: "sessions",
      label: `$${SECURITY}.active_sessions`,
      value: security.activeSessions || `$${SECURITY}.no_session`,
      detail: security.sessionLocations.join(LOCATION_SEPARATOR) || undefined,
    },
    verificationItem(security),
  ];
}
