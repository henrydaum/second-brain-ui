import type { FC } from "react";
import {
  BotIcon,
  BoxIcon,
  BrainCircuitIcon,
  BracesIcon,
  CheckCircle2Icon,
  CommandIcon,
  FileCogIcon,
  ListTreeIcon,
  LockKeyholeIcon,
  NetworkIcon,
  PackageIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";

import type { Command } from "@/lib/commands";

export type SettingsPageId =
  | "agents"
  | "security"
  | "plugins"
  | "config"
  | "packages"
  | "misc";

export type SettingsPage = {
  id: SettingsPageId;
  label: string;
  description: string;
  icon: FC<{ className?: string }>;
};

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: "agents",
    label: "Agents and Models",
    description: "Choose the models and agent profiles used for conversations.",
    icon: BrainCircuitIcon,
  },
  {
    id: "security",
    label: "Security",
    description: "Control permission behavior and review standing access.",
    icon: ShieldCheckIcon,
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Manage the capabilities installed around the Second Brain kernel.",
    icon: BoxIcon,
  },
  {
    id: "config",
    label: "Configuration",
    description: "Browse and edit kernel, plugin, and user configuration.",
    icon: FileCogIcon,
  },
  {
    id: "packages",
    label: "Packages",
    description: "Browse, install, and remove Second Brain packages.",
    icon: PackageIcon,
  },
  {
    id: "misc",
    label: "Miscellaneous",
    description: "Other kernel commands and commands provided by installed packages.",
    icon: CommandIcon,
  },
];

const PAGE_COMMANDS: Record<SettingsPageId, ReadonlySet<string>> = {
  agents: new Set(["llm", "agent"]),
  security: new Set(["mode", "permissions"]),
  plugins: new Set(["commands", "tools", "tasks", "services", "frontends"]),
  config: new Set(["config"]),
  packages: new Set(["packages"]),
  misc: new Set(),
};

export const SYSTEM_ACTIONS = [
  {
    name: "update",
    label: "Update",
    description: "Pull the latest changes from the repository.",
    icon: RefreshCwIcon,
    tone: "ghost" as const,
    danger: false,
  },
  {
    name: "restart",
    label: "Restart",
    description: "Restart the running application.",
    icon: RotateCcwIcon,
    tone: "ghost" as const,
    danger: false,
  },
  {
    name: "quit",
    label: "Shut down",
    description: "Stop the running application.",
    icon: PowerIcon,
    tone: "ghost" as const,
    danger: true,
  },
] as const;

export const SYSTEM_ACTION_NAMES: ReadonlySet<string> = new Set(
  SYSTEM_ACTIONS.map((action) => action.name),
);

export function pageForCommand(name?: string | null): SettingsPageId {
  if (!name || SYSTEM_ACTION_NAMES.has(name)) return "misc";
  for (const page of SETTINGS_PAGES) {
    if (PAGE_COMMANDS[page.id].has(name)) return page.id;
  }
  return "misc";
}

export function commandsForPage(
  commands: Command[],
  page: SettingsPageId,
): Command[] {
  return commands.filter((command) => {
    if (SYSTEM_ACTION_NAMES.has(command.name)) return false;
    return pageForCommand(command.name) === page;
  });
}

const COMMAND_PRESENTATION: Record<
  string,
  { title: string; detail: string; icon: FC<{ className?: string }> }
> = {
  llm: {
    title: "Language models",
    detail: "Choose, edit, load, or remove model profiles.",
    icon: BrainCircuitIcon,
  },
  agent: {
    title: "Agent profiles",
    detail: "Select the tools, model, and behavior used for a session.",
    icon: BotIcon,
  },
  mode: {
    title: "Security mode",
    detail: "Choose how this conversation handles permission requests.",
    icon: LockKeyholeIcon,
  },
  permissions: {
    title: "Standing permissions",
    detail: "Review and withdraw permissions granted previously.",
    icon: ShieldCheckIcon,
  },
  commands: {
    title: "Commands",
    detail: "Review commands provided by the kernel and installed packages.",
    icon: BracesIcon,
  },
  tools: {
    title: "Tools",
    detail: "Inspect available tools and run one directly.",
    icon: WrenchIcon,
  },
  tasks: {
    title: "Tasks",
    detail: "Pause, resume, retry, reset, or trigger tasks.",
    icon: CheckCircle2Icon,
  },
  services: {
    title: "Services",
    detail: "Load and manage persistent capabilities.",
    icon: NetworkIcon,
  },
  frontends: {
    title: "Frontends",
    detail: "Enable or disable connected interaction surfaces.",
    icon: ListTreeIcon,
  },
  config: {
    title: "Open configuration",
    detail: "Browse kernel, plugin, and user settings.",
    icon: Settings2Icon,
  },
  packages: {
    title: "Manage packages",
    detail: "Browse, install, or uninstall store packages by category.",
    icon: PackageIcon,
  },
};

function titleFromName(name: string) {
  return name
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function commandPresentation(command: Command) {
  return (
    COMMAND_PRESENTATION[command.name] ?? {
      title: titleFromName(command.name),
      detail: command.description || "Run this Second Brain command.",
      icon: SquareTerminalIcon,
    }
  );
}
