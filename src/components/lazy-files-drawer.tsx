import { lazy } from "react";

let drawerModule: ReturnType<typeof importDrawer> | null = null;

function importDrawer() {
  return import("@/components/files-drawer");
}

function loadDrawer() {
  drawerModule ??= importDrawer();
  return drawerModule;
}

export const LazyFilesDrawer = lazy(() =>
  loadDrawer().then((module) => ({ default: module.FilesDrawer })),
);

export function preloadFilesDrawer() {
  void loadDrawer();
}
