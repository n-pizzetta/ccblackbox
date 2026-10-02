/** Lets the top-bar menu switch the dashboard tab, which FleetDashboard owns. */
export const OPEN_TAB_EVENT = "ccblackbox:open-tab";

export type DashboardTab = "rankings" | "health" | "analysis";

export function openDashboardTab(tab: DashboardTab): void {
  window.dispatchEvent(new CustomEvent<DashboardTab>(OPEN_TAB_EVENT, { detail: tab }));
}
