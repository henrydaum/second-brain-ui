/**
 * Host scratch paths for attachments that are still in the composer.
 *
 * The upload adapter learns the path, while the attachment tile owns the View
 * affordance. Keeping this transport detail in a tiny shared registry lets the
 * tile use the normal host-file renderer without putting a filesystem path in
 * assistant-ui's message content.
 */
const hostPaths = new Map<string, string>();

export const rememberStagedPath = (id: string, path: string) => {
  hostPaths.set(id, path);
};

export const stagedPath = (id: string): string | undefined => hostPaths.get(id);

export const forgetStagedPath = (id: string) => {
  hostPaths.delete(id);
};
