import type { Conversation } from "@/lib/conversations";

export type ConversationFilter =
  | { type: "all" }
  | { type: "category"; category: string | null };

export type ConversationFilterOption = {
  filter: ConversationFilter;
  label: string;
  count: number;
};

export const ALL_CONVERSATIONS_FILTER: ConversationFilter = { type: "all" };
export const MAIN_CONVERSATIONS_FILTER: ConversationFilter = {
  type: "category",
  category: null,
};

const BUILT_IN_CATEGORIES = ["Subagent", "Scheduled"];

/** Blank is the server's representation of an ordinary, person-owned chat. */
export function conversationCategory(category?: string | null): string | null {
  const trimmed = category?.trim() ?? "";
  return trimmed || null;
}

export function categoryLabel(category: string | null): string {
  return category ?? "Main";
}

export function filtersEqual(
  left: ConversationFilter,
  right: ConversationFilter,
): boolean {
  return (
    left.type === right.type &&
    (left.type === "all" ||
      (right.type === "category" && left.category === right.category))
  );
}

export function filterIncludes(
  filter: ConversationFilter,
  conversation: Conversation,
): boolean {
  return (
    filter.type === "all" ||
    conversationCategory(conversation.category) === filter.category
  );
}

export function conversationFilterOptions(
  conversations: Conversation[],
): ConversationFilterOption[] {
  const counts = new Map<string | null, number>();
  for (const conversation of conversations) {
    const category = conversationCategory(conversation.category);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const categories = [...counts.keys()];
  const builtIns = BUILT_IN_CATEGORIES.filter((category) =>
    counts.has(category),
  );
  const pluginCategories = categories
    .filter(
      (category): category is string =>
        category !== null && !BUILT_IN_CATEGORIES.includes(category),
    )
    .sort((left, right) => left.localeCompare(right));

  return [
    {
      filter: ALL_CONVERSATIONS_FILTER,
      label: "All conversations",
      count: conversations.length,
    },
    {
      filter: MAIN_CONVERSATIONS_FILTER,
      label: "Main",
      count: counts.get(null) ?? 0,
    },
    ...[...builtIns, ...pluginCategories].map((category) => ({
      filter: { type: "category", category } as ConversationFilter,
      label: category,
      count: counts.get(category) ?? 0,
    })),
  ];
}

/** FNV-1a gives a stable hue without maintaining a palette or stored mapping. */
export function categoryHue(category: string): number {
  const normalized = category.normalize("NFKC").toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
