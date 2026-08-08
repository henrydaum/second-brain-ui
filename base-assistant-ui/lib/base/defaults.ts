export type BaseSuggestionIconId =
  | "weather"
  | "code"
  | "write"
  | "analyze"
  | "brainstorm"
  | "search"
  | "document"
  | "help";

export type BaseThemePresetId =
  | "assistantDark"
  | "assistantLight"
  | "neutralDark"
  | "neutralLight";

export type BaseTheme = {
  preset: BaseThemePresetId;
  accent: string;
  background: string;
  surface: string;
  text: string;
};

export type ResolvedBaseConfig = {
  brandTheme: BaseTheme;
  assistant: {
    appName: string;
    welcome: {
      headline: string;
      body: string;
    };
    labels: {
      composerPlaceholder: string;
      newThread: string;
      newChat: string;
    };
    suggestionGroups: Array<{
      id: string;
      label: string;
      icon: BaseSuggestionIconId;
      options: Array<{
        label: string;
        prompt: string;
        flowId?: string;
      }>;
    }>;
    slashCommands: Array<{
      id: string;
      description: string;
      icon: "FileText" | "Languages" | "Globe" | "HelpCircle";
    }>;
    tools: Array<{
      id: string;
      displayName: string;
      aiDescription: string;
      rendererType: "generic";
    }>;
    demoFlows: Record<
      string,
      {
        title?: string;
        triggerPhrases: string[];
        steps: Array<{
          id: string;
          assistantText: string;
          toolId: string;
          input: unknown;
          output: unknown;
        }>;
        finalResponse: string;
      }
    >;
    demoModeNotice: string;
  };
};

export const defaultBaseConfig = {
  "brandTheme": {
    "preset": "assistantDark",
    "accent": "#fafafa",
    "background": "#050505",
    "surface": "#171717",
    "text": "#fafafa"
  },
  "assistant": {
    "appName": "assistant-ui",
    "welcome": {
      "headline": "How can I help you today?",
      "body": ""
    },
    "labels": {
      "composerPlaceholder": "Send a message... (@ to mention, / for commands)",
      "newThread": "New Thread",
      "newChat": "New Chat"
    },
    "suggestionGroups": [
      {
        "id": "weather",
        "label": "Weather",
        "icon": "weather",
        "options": [
          {
            "label": "in San Francisco",
            "prompt": "What's the weather in San Francisco?",
            "flowId": "weather"
          },
          {
            "label": "in Singapore",
            "prompt": "What's the weather in Singapore?",
            "flowId": "weather"
          },
          {
            "label": "in Tokyo",
            "prompt": "What's the weather in Tokyo?",
            "flowId": "weather"
          },
          {
            "label": "in London",
            "prompt": "What's the weather in London?",
            "flowId": "weather"
          }
        ]
      },
      {
        "id": "code",
        "label": "Code",
        "icon": "code",
        "options": [
          {
            "label": "explain React hooks",
            "prompt": "Explain React hooks like useState and useEffect",
            "flowId": "code"
          },
          {
            "label": "write a debounce function",
            "prompt": "Write a debounce function in TypeScript",
            "flowId": "code"
          },
          {
            "label": "review a useEffect cleanup",
            "prompt": "Show me the right way to clean up a subscription in useEffect",
            "flowId": "code"
          }
        ]
      },
      {
        "id": "write",
        "label": "Write",
        "icon": "write",
        "options": [
          {
            "label": "a product announcement",
            "prompt": "Draft a short product announcement for a new dark mode",
            "flowId": "writing"
          },
          {
            "label": "release notes",
            "prompt": "Write release notes for a bugfix release of a React component library",
            "flowId": "writing"
          },
          {
            "label": "a PR description",
            "prompt": "Write a pull request description for a change that adds keyboard shortcuts",
            "flowId": "writing"
          }
        ]
      },
      {
        "id": "analyze",
        "label": "Analyze",
        "icon": "analyze",
        "options": [
          {
            "label": "React vs Vue vs Svelte",
            "prompt": "Compare React, Vue, and Svelte in a table",
            "flowId": "analysis"
          },
          {
            "label": "GDP of US, China, Japan",
            "prompt": "Compare the GDP of the United States, China, and Japan in a table",
            "flowId": "analysis"
          },
          {
            "label": "pros and cons of SSR",
            "prompt": "What are the pros and cons of server-side rendering?",
            "flowId": "analysis"
          }
        ]
      },
      {
        "id": "brainstorm",
        "label": "Brainstorm",
        "icon": "brainstorm",
        "options": [
          {
            "label": "side project ideas",
            "prompt": "Brainstorm five side project ideas for a React developer",
            "flowId": "brainstorm"
          },
          {
            "label": "names for a dev tool",
            "prompt": "Brainstorm names for a developer tools startup",
            "flowId": "brainstorm"
          },
          {
            "label": "talk topics",
            "prompt": "Brainstorm talk topics for a React meetup",
            "flowId": "brainstorm"
          }
        ]
      }
    ],
    "slashCommands": [
      {
        "id": "summarize",
        "description": "Summarize the conversation",
        "icon": "FileText"
      },
      {
        "id": "translate",
        "description": "Translate text to another language",
        "icon": "Languages"
      },
      {
        "id": "search",
        "description": "Search the web for information",
        "icon": "Globe"
      },
      {
        "id": "help",
        "description": "List available commands",
        "icon": "HelpCircle"
      }
    ],
    "tools": [
      {
        "id": "getWeather",
        "displayName": "Weather",
        "aiDescription": "Look up current weather for a city.",
        "rendererType": "generic"
      },
      {
        "id": "inspectCode",
        "displayName": "Code Helper",
        "aiDescription": "Explain or draft code examples.",
        "rendererType": "generic"
      },
      {
        "id": "draftContent",
        "displayName": "Writing Helper",
        "aiDescription": "Draft short product, release, or PR content.",
        "rendererType": "generic"
      },
      {
        "id": "compareItems",
        "displayName": "Analysis Helper",
        "aiDescription": "Compare concepts and return structured analysis.",
        "rendererType": "generic"
      },
      {
        "id": "brainstormIdeas",
        "displayName": "Brainstorm Helper",
        "aiDescription": "Generate and organize ideas.",
        "rendererType": "generic"
      }
    ],
    "demoFlows": {
      "weather": {
        "title": "Weather lookup",
        "triggerPhrases": [
          "weather",
          "forecast",
          "temperature"
        ],
        "steps": [
          {
            "id": "lookup-weather",
            "assistantText": "I will check the demo weather data first.",
            "toolId": "getWeather",
            "input": {
              "city": "San Francisco",
              "units": "fahrenheit"
            },
            "output": {
              "city": "San Francisco",
              "summary": "Partly cloudy",
              "temperature": "64 F",
              "wind": "12 mph"
            }
          }
        ],
        "finalResponse": "The demo weather check is ready. It is partly cloudy and mild in the sample data."
      },
      "code": {
        "title": "Code help",
        "triggerPhrases": [
          "code",
          "typescript",
          "react",
          "debounce",
          "hook"
        ],
        "steps": [
          {
            "id": "inspect-code-request",
            "assistantText": "I will map the request to a compact code example.",
            "toolId": "inspectCode",
            "input": {
              "language": "typescript",
              "topic": "React helper"
            },
            "output": {
              "language": "typescript",
              "notes": [
                "Keep side effects isolated.",
                "Type inputs and return values."
              ]
            }
          }
        ],
        "finalResponse": "Here is the short version: keep the helper typed, keep side effects explicit, and test the edge case before wiring it into UI."
      },
      "writing": {
        "title": "Writing help",
        "triggerPhrases": [
          "write",
          "draft",
          "announcement",
          "release",
          "pr"
        ],
        "steps": [
          {
            "id": "draft-outline",
            "assistantText": "I will draft a concise outline before the final copy.",
            "toolId": "draftContent",
            "input": {
              "format": "short-form",
              "tone": "clear"
            },
            "output": {
              "outline": [
                "What changed",
                "Why it matters",
                "Next action"
              ]
            }
          }
        ],
        "finalResponse": "Draft structure: lead with what changed, explain why it matters in one sentence, then give the reader a clear next action."
      },
      "analysis": {
        "title": "Comparison",
        "triggerPhrases": [
          "compare",
          "analysis",
          "pros",
          "cons",
          "table"
        ],
        "steps": [
          {
            "id": "compare-items",
            "assistantText": "I will organize the comparison into clear criteria.",
            "toolId": "compareItems",
            "input": {
              "criteria": [
                "strengths",
                "tradeoffs",
                "best fit"
              ]
            },
            "output": {
              "columns": [
                "Option",
                "Strength",
                "Tradeoff",
                "Best fit"
              ],
              "rows": 3
            }
          }
        ],
        "finalResponse": "The comparison should separate strengths, tradeoffs, and best-fit cases so the decision is easier to scan."
      },
      "brainstorm": {
        "title": "Brainstorm",
        "triggerPhrases": [
          "brainstorm",
          "ideas",
          "names",
          "topics"
        ],
        "steps": [
          {
            "id": "generate-ideas",
            "assistantText": "I will generate a small, grouped idea set.",
            "toolId": "brainstormIdeas",
            "input": {
              "count": 5,
              "grouping": "themes"
            },
            "output": {
              "themes": [
                "Practical",
                "Playful",
                "Developer-focused"
              ],
              "count": 5
            }
          }
        ],
        "finalResponse": "A useful brainstorm should include a few safe options, a few sharper options, and one intentionally different direction."
      }
    },
    "demoModeNotice": "Demo mode is running because OPENAI_API_KEY is not set. Add it to .env.local for live model responses."
  }
} satisfies ResolvedBaseConfig;
