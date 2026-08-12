import { describe, expect, it } from "vitest";

import { commandsForPage } from "@/components/settings-structure";
import type { Command } from "@/lib/commands";

describe("commandsForPage", () => {
  it("omits commands that already have dedicated conversation controls", () => {
    const commands: Command[] = [
      { name: "cancel" },
      { name: "new" },
      { name: "reveal" },
    ];

    expect(commandsForPage(commands, "misc").map((command) => command.name)).toEqual([
      "reveal",
    ]);
  });
});
