import { lazy } from "react";

let viewerModule: ReturnType<typeof importViewer> | null = null;

function importViewer() {
  return import("@/components/file-viewer-dialog");
}

function loadViewer() {
  viewerModule ??= importViewer();
  return viewerModule;
}

export const LazyFileViewerDialog = lazy(() =>
  loadViewer().then((module) => ({ default: module.FileViewerDialog })),
);

export function preloadFileViewer() {
  void loadViewer();
}
