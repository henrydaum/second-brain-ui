import { createOpenAI } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  stepCountIs,
  streamText,
  type JSONSchema7,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { resolveModelId } from "@/constants/model";
import { defaultBaseConfig, type ResolvedBaseConfig } from "@/lib/base/defaults";

export const maxDuration = 30;

const demoTiming = {
  beforeFirstTextMs: 180,
  beforeToolInputMs: 160,
  toolThinkingMs: 320,
  afterToolOutputMs: 220,
  wordMs: 14,
};

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools,
    config,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    config?: { modelName?: string };
  } = await req.json();
  const modelId = resolveModelId(config?.modelName);

  const uiStream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      if (!process.env.OPENAI_API_KEY) {
        await streamBaseFallback(writer, messages, defaultBaseConfig);
        return;
      }

      await streamProviderRun(writer, {
        messages,
        system,
        tools: tools ?? {},
        modelId,
      });
    },
  });

  return new Response(
    uiStream
      .pipeThrough(new JsonToSseTransformStream())
      .pipeThrough(new TextEncoderStream()),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
}

async function streamProviderRun(
  writer: UIMessageStreamWriter,
  {
    messages,
    system,
    tools,
    modelId,
  }: {
    messages: UIMessage[];
    system?: string;
    tools: Record<string, { description?: string; parameters: JSONSchema7 }>;
    modelId: string;
  },
) {
  const aiSDKTools = frontendTools(tools);

  const result = streamText({
    model: openai.chat(modelId),
    system,
    messages: await convertToModelMessages(messages, { tools: aiSDKTools }),
    stopWhen: stepCountIs(6),
    tools: aiSDKTools,
  });

  for await (const chunk of result.toUIMessageStream()) {
    writer.write(chunk);
  }
}

async function streamBaseFallback(
  writer: UIMessageStreamWriter,
  messages: UIMessage[],
  config: ResolvedBaseConfig,
) {
  const lastUserMessage = messages.filter((message) => message.role === "user").at(-1);
  const prompt = extractText(lastUserMessage) || "your message";
  const flowId = chooseDemoFlow(prompt, config);
  const flow = config.assistant.demoFlows[flowId];
  const messageId = `msg-${crypto.randomUUID()}`;

  writer.write({ type: "start", messageId });
  writer.write({ type: "start-step" });
  await sleep(demoTiming.beforeFirstTextMs);

  if (!flow) {
    await writeText(
      writer,
      [config.assistant.demoModeNotice, "", `You said: ${prompt}`].join("\n"),
    );
    writer.write({ type: "finish-step" });
    writer.write({ type: "finish" });
    return;
  }

  if (flow.title) {
    await writeText(writer, `${flow.title}\n\n`);
  }

  for (const step of flow.steps) {
    await writeText(writer, `${step.assistantText}\n\n`);
    await writeToolStep(writer, step);
  }

  await writeText(
    writer,
    `\n${flow.finalResponse}\n\n${config.assistant.demoModeNotice}`,
  );

  writer.write({ type: "finish-step" });
  writer.write({ type: "finish" });
}

async function writeText(writer: UIMessageStreamWriter, text: string) {
  const textId = `txt-${crypto.randomUUID()}`;
  writer.write({ type: "text-start", id: textId });
  for (const word of text.match(/\S+\s*|\s+/g) ?? [text]) {
    writer.write({ type: "text-delta", id: textId, delta: word });
    await sleep(demoTiming.wordMs);
  }
  writer.write({ type: "text-end", id: textId });
}

async function writeToolCall(
  writer: UIMessageStreamWriter,
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
) {
  const toolCallId = `call-${crypto.randomUUID()}`;
  await sleep(demoTiming.beforeToolInputMs);
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName,
    input,
    providerExecuted: true,
  });
  await sleep(demoTiming.toolThinkingMs);
  writer.write({
    type: "tool-output-available",
    toolCallId,
    output,
    providerExecuted: true,
  });
  await sleep(demoTiming.afterToolOutputMs);
}

async function writeToolStep(
  writer: UIMessageStreamWriter,
  step: ResolvedBaseConfig["assistant"]["demoFlows"][string]["steps"][number],
) {
  await writeToolCall(writer, step.toolId, asRecord(step.input), step.output);
}

function chooseDemoFlow(prompt: string, config: ResolvedBaseConfig) {
  const normalizedPrompt = normalize(prompt);
  for (const group of config.assistant.suggestionGroups) {
    for (const option of group.options) {
      if (option.flowId && normalize(option.prompt) === normalizedPrompt) {
        return option.flowId;
      }
    }
  }

  for (const [flowId, flow] of Object.entries(config.assistant.demoFlows)) {
    if (
      flow.triggerPhrases.some((phrase) =>
        normalizedPrompt.includes(normalize(phrase)),
      )
    ) {
      return flowId;
    }
  }

  return Object.keys(config.assistant.demoFlows)[0];
}

function extractText(message: UIMessage | undefined) {
  return (
    message?.parts
      ?.flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(" ")
      .trim() ?? ""
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function normalize(value: string) {
  return value.toLowerCase().trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
