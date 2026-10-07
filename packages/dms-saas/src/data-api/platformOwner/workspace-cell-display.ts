import { ColumnDisplay, RegisterDisplay } from "@antelopejs/interface-dms/base";

/**
 * The workspace directory cells that read sibling fields of the row:
 * `plan` (name, then price × seats), `mrr` (amount, then what it means:
 * yearly ÷ 12, at risk, billing paused, then €29.00 after a trial), `owner`
 * (name or e-mail, then joined / invitation pending / expired) and `renewal`
 * (what happens, then the date).
 */
export type WorkspaceCellKind = "plan" | "mrr" | "owner" | "renewal";

export interface WorkspaceCellDisplayOptions {
  kind: WorkspaceCellKind;
}

/** A two-line workspace directory cell, drawn by the module's frontend. */
@RegisterDisplay("saas:workspace_cell")
export class WorkspaceCellDisplay extends ColumnDisplay<WorkspaceCellDisplayOptions> {}
