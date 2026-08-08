/**
 * The command catalogue, and what running one means.
 *
 * The server hands over its entire vocabulary — name, description, category,
 * and the shape of the form each one collects — so Settings can organize what
 * actually exists without maintaining a second command list.
 */

import { sdk } from "@/lib/client";

export type Command = {
  name: string;
  description?: string;
  /** "System", "Conversation", "Capabilities", "Automation". */
  category?: string;
  /** The arguments it will ask for. Empty means it runs immediately.
   *
   *  Only used here to tell the person what to expect — the *collecting* is the
   *  server's job, arriving as `form_field` frames that `form-panel.tsx` draws.
   *  Duplicating that logic client-side is how the old draft ended up parsing
   *  slash commands by hand. */
  form?: { name: string; required?: boolean }[];
};

/**
 * Every command this session can run.
 *
 * `visible: true` asks the server to filter by what makes sense on this
 * frontend. It currently returns all 22 either way, which is fine — the point
 * is that the filtering is the server's call to make, not ours to guess.
 */
export async function listCommands(): Promise<Command[]> {
  const data = await sdk<Command[] | { items?: Command[] } | null>(
    "command.list",
    { details: true, visible: true },
  );
  // `conv.list` answers `{items}` with `details` and a bare array without, so
  // the shape is worth being tolerant about rather than assuming.
  const commands = Array.isArray(data) ? data : (data?.items ?? []);
  return [...commands].sort((a, b) => a.name.localeCompare(b.name));
}
