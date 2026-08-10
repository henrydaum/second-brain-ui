import { lazy } from "react";

let fileViewModule: ReturnType<typeof importFileView> | null = null;

function importFileView() {
  return import("@/components/file-view");
}

function loadFileView() {
  fileViewModule ??= importFileView();
  return fileViewModule;
}

export const LazyFileView = lazy(() =>
  loadFileView().then((module) => ({ default: module.FileView })),
);

export function preloadFileView() {
  void loadFileView();
}
