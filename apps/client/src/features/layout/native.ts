import { invoke, isTauri } from "@tauri-apps/api/core";
import { panelIds, type PanelId } from "./model";
export const nativePanelsAvailable = () => isTauri();
export function detachedPanel(search = window.location.search): PanelId | null {
  const p = new URLSearchParams(search).get("panel");
  return panelIds.includes(p as PanelId) ? (p as PanelId) : null;
}
export const openPanel = (panel: PanelId) =>
  invoke<void>("open_panel", { panel });
export const closePanel = (panel: PanelId) =>
  invoke<void>("close_panel", { panel });
export const listPanels = () => invoke<PanelId[]>("list_panels");
export type PanelActionName =
  | "select_file"
  | "select_tab"
  | "close_tab"
  | "select_commit"
  | "select_branch"
  | "load_more"
  | "set_selection"
  | "set_view"
  | "refresh"
  | "redock"
  | "set_explanation_layout"
  | "show_explanation"
  | "open_commit_file"
  | "compare_commits"
  | "explanation_layout"
  | "explain_detail"
  | "review_decision"
  | "refresh_explanations"
  | "open_revision";
export type PanelAction = {
  panel: PanelId;
  action: PanelActionName;
  payload: unknown;
};
export const publishPanelState = (state: unknown) =>
  invoke<void>("publish_panel_state", { state });
export const readPanelState = <T>(sinceRevision?: number) =>
  invoke<{ revision: number; state: T | null }>("read_panel_state", {
    sinceRevision,
  });
export const sendPanelAction = (action: PanelActionName, payload: unknown) =>
  invoke<void>("send_panel_action", { action, payload });
export const drainPanelActions = () =>
  invoke<PanelAction[]>("drain_panel_actions");
