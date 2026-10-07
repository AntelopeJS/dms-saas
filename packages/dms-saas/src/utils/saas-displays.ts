import { ColumnDisplay, RegisterDisplay } from "@antelopejs/interface-dms/base";

/** Options of {@link CountChangeDisplay}. */
export interface CountChangeDisplayOptions {
  /** Row field holding the change of the count over the period. */
  changeField: string;
  /** i18n key (with `$`) naming the period, receiving `{ change }`. */
  changeLabel?: string;
}

/**
 * A count with its change under it, toned up or down ("37 · ▲ +4 this
 * week"); no change reads as a dimmed "— 0".
 */
@RegisterDisplay("saas:count-change")
export class CountChangeDisplay extends ColumnDisplay<CountChangeDisplayOptions> {}

/** Options of {@link UserWorkspacesDisplay}. */
export interface UserWorkspacesDisplayOptions {
  /** Row field holding the number of workspaces the user owns. */
  ownedField: string;
  /** Row field holding the number of workspaces the user is a member of. */
  memberField: string;
}

/**
 * The number of workspaces of a user, split under it into owned and member
 * ("3 · 1 owned · 2 member"), or "No workspace".
 */
@RegisterDisplay("saas:user-workspaces")
export class UserWorkspacesDisplay extends ColumnDisplay<UserWorkspacesDisplayOptions> {}
