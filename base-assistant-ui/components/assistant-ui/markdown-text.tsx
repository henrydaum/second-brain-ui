"use client";

import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="aui-md" />;
}
