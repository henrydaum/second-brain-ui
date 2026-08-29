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
import { titleCase } from "@/lib/utils";

export type SettingsPageId =
  | "agents"
  | "security"
  | "plugins"
  | "config"
  | "misc";

type SettingsPage = {
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
    id: "misc",
    label: "Miscellaneous",
    description: "Other kernel commands and commands provided by installed packages.",
    icon: CommandIcon,
  },
];

const PAGE_COMMANDS: Record<SettingsPageId, ReadonlySet<string>> = {
  agents: new Set(["llm", "agent"]),
  security: new Set(["mode", "permissions"]),
  plugins: new Set([
    "commands",
    "tools",
    "tasks",
    "services",
    "frontends",
    "packages",
  ]),
  config: new Set(["config"]),
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

/** Commands that remain valid in chat but already have first-class controls
 * elsewhere in the UI. Repeating them in Miscellaneous makes Settings look
 * like an action menu and gives two ways to perform the same immediate action. */
const DEDICATED_UI_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "cancel",
  "new",
]);

/**
 * Which section a notification is about, when it is about one at all.
 *
 * **Keyed on `source`, which is the only field here that can be trusted.** It is
 * stamped by the kernel off the live provenance chain rather than stated by
 * whoever raised the notification, so a plugin cannot route itself somewhere it
 * does not belong by claiming to be the config announcer.
 *
 * Most notifications map to nothing and that is the honest answer — a scheduled
 * agent finishing has a *conversation* to offer, not a settings page. Returning
 * null is what keeps the link off those rows rather than sending them somewhere
 * arbitrary.
 *
 * **The section, not the setting.** Settings has no per-setting address to link
 * to: a section is a page, and each individual setting is a slash command run
 * inside it. So `config` is as precise as this can honestly be, and the
 * notification's own body already names which settings changed.
 */
const NOTIFICATION_PAGES: Record<string, SettingsPageId> = {
  config: "config",
};

export function pageForNotification(source: string): SettingsPageId | null {
  return NOTIFICATION_PAGES[source] ?? null;
}

/**
 * The section that owns a setting `/config` will not open.
 *
 * **These have a home; it is just not Configuration.** A `hidden` declaration
 * means the setting is managed somewhere better than a generic key/value form —
 * `default_llm_profile` and `llm_profiles` through `/llm`, the agent profiles
 * through `/agent`, `frontend_profiles` through `/frontends` — and `/config`
 * leaves every one of them out of its catalogue. Landing on Configuration for
 * those is landing on the one page that provably does not list them.
 *
 * Only the settings with somewhere better to be. A hidden setting managed by
 * nothing the UI shows — `scheduled_jobs`, which belongs to the timekeeper
 * service — is absent on purpose and falls back to the section, where the
 * notification body has already named it.
 */
const SETTING_PAGES: Record<string, SettingsPageId> = {
  llm_profiles: "agents",
  default_llm_profile: "agents",
  agent_profiles: "agents",
  active_agent_profile: "agents",
  frontend_profiles: "plugins",
};

export function pageForSetting(setting: string): SettingsPageId | null {
  return SETTING_PAGES[setting] ?? null;
}

/**
 * The command that opens one setting.
 *
 * `/config` takes its arguments positionally — category, then setting name — and
 * naming the setting is what makes the form skip the category and plugin steps
 * and go straight to that setting's own page. `all` is the category that does
 * not have to be right: it is the one that matches wherever the setting
 * actually lives, so this never has to work out whether something is a kernel,
 * plugin or user setting to link to it.
 *
 * Safe to interpolate only because `settingNamesOf` has already thrown away
 * anything that is not identifier-shaped. Nothing here quotes, and nothing here
 * needs to.
 */
export function settingCommand(setting: string): string {
  return `/config all ${setting}`;
}


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
    if (DEDICATED_UI_COMMAND_NAMES.has(command.name.toLowerCase())) return false;
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

export function commandPresentation(command: Command) {
  return (
    COMMAND_PRESENTATION[command.name] ?? {
      title: titleCase(command.name),
      detail: command.description || "Run this Second Brain command.",
      icon: SquareTerminalIcon,
    }
  );
}
