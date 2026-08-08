/**
 * The command catalogue, and what running one means.
 *
 * This is the feature that motivated the whole project: real buttons instead of
 * remembering that the incantation is `/packages install foo`. The server hands
 * over its entire vocabulary — name, description, category, and the shape of the
 * form each one collects — so the palette is a rendering of the server's own
 * catalogue rather than a list this app has to keep in step.
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

/**
 * What a person sees when a command is about to ask them things.
 *
 * Not validation and not a preview of the form — just an honest hint that
 * choosing this opens a conversation rather than doing something at once.
 */
export function describeForm(command: Command): string | undefined {
  const fields = command.form ?? [];
  if (fields.length === 0) return undefined;
  const required = fields.filter((field) => field.required).length;
  return required > 0
    ? `asks for ${fields.length === 1 ? "1 answer" : `${fields.length} answers`}`
    : "optional arguments";
}
