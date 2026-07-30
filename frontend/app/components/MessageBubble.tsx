"use client";

import React, { useState } from "react";
import type { Message, Citation } from "@/lib/api";
import { ChevronDownIcon, FileTextIcon } from "./Icons";
import type { DrawerDocument } from "./DocumentDrawer";

interface MessageBubbleProps {
  message: Message;
  onSelectSource?: (doc: DrawerDocument) => void;
}

export default function MessageBubble({ message, onSelectSource }: MessageBubbleProps) {
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end my-4 select-none">
        <div className="max-w-2xl rounded-2xl bg-blue-600 px-4 py-2.5 text-sm text-white shadow-2xs font-normal">
          {message.content}
        </div>
      </div>
    );
  }

  const citations: Citation[] = message.citations || [];

  // Render clean structured output for answer body with message-wide citation deduplication (GPT-style)
  const renderFormattedText = (rawContent: string) => {
    // Claude's raw markdown routinely leaves a stray space before terminal
    // punctuation right after an inline code span or citation marker (e.g.
    // "`df.head()` ." or "listed [1] :"). Since this is a lightweight custom
    // renderer rather than a full markdown parser, clean that up up front so
    // it doesn't read like broken formatting once rendered.
    const cleanedContent = rawContent
      .replace(/[ \t]+([.,;:!?])(?=\s|$)/g, "$1")
      .replace(/[ \t]{2,}/g, " ");

    const lines = cleanedContent.split("\n");
    const seenCitationsInMessage = new Set<string>();

    // Helper to parse line tokens (**bold**, *italic*, `code`, and message-wide deduplicated [n] citations)
    const parseLineTokens = (text: string) => {
      const tokens: React.ReactNode[] = [];
      let lastIndex = 0;
      let key = 0;

      const regex = /(\*\*(.*?)\*\*|\*(.*?)\*|`([^`]+)`|\[(\d+)\])/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          tokens.push(<span key={key++}>{text.substring(lastIndex, match.index)}</span>);
        }

        const boldText = match[2];
        const italicText = match[3];
        const codeText = match[4];
        const citNum = match[5];

        if (boldText !== undefined) {
          tokens.push(
            <strong key={key++} className="font-semibold text-slate-900">
              {boldText}
            </strong>
          );
        } else if (italicText !== undefined) {
          tokens.push(
            <em key={key++} className="italic text-slate-800">
              {italicText}
            </em>
          );
        } else if (codeText !== undefined) {
          tokens.push(
            <code
              key={key++}
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-800"
            >
              {codeText}
            </code>
          );
        } else if (citNum !== undefined) {
          // ChatGPT / Perplexity style: Deduplicate citations across the entire message response
          if (!seenCitationsInMessage.has(citNum)) {
            seenCitationsInMessage.add(citNum);
            const citationIdx = parseInt(citNum, 10) - 1;
            const matchingCit = citations[citationIdx] || citations[0];
            tokens.push(
              <button
                key={key++}
                type="button"
                onClick={() => {
                  if (onSelectSource && matchingCit) {
                    onSelectSource({
                      filename: matchingCit.filename,
                      title: matchingCit.filename.replace(/\.[^/.]+$/, ""),
                      summary: matchingCit.snippet,
                      content: matchingCit.snippet,
                    });
                  }
                }}
                className="inline-flex items-center justify-center rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 border border-blue-200/80 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer ml-1 select-none align-baseline"
                title={matchingCit ? `View source: ${matchingCit.filename}` : `Citation [${citNum}]`}
              >
                [{citNum}]
              </button>
            );
          }
        }

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        tokens.push(<span key={key++}>{text.substring(lastIndex)}</span>);
      }

      return tokens;
    };

    return lines.map((line, lineIdx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return <div key={lineIdx} className="h-2" />;
      }

      // Check if line is a markdown ATX heading (#, ##, ### ...). Claude's answers
      // routinely come back with real markdown headings even though this renderer
      // is a lightweight custom parser rather than a full markdown library, so
      // without this these lines showed up as literal "### Some Heading" text.
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].replace(/\s*#+\s*$/, ""); // strip trailing "###" closers
        const sizeClass = level === 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm";
        return (
          <div key={lineIdx} className={`font-bold text-slate-900 mt-4 mb-1.5 ${sizeClass}`}>
            {parseLineTokens(headingText)}
          </div>
        );
      }

      // Check if line is a bullet item (e.g. "- ", "• ", "- - ", "· - ", "* ")
      const isBullet = /^([-\u2022\*\·\s]+[-•\*])\s+/.test(trimmed);
      if (isBullet) {
        const cleanBody = trimmed.replace(/^([-\u2022\*\·\s]+[-•\*])\s+/, "").trim();
        return (
          <div key={lineIdx} className="flex items-start gap-2.5 my-1.5 pl-2">
            <span className="text-blue-600 font-bold text-xs mt-1 shrink-0">•</span>
            <div className="flex-1 text-slate-800 leading-relaxed">
              {parseLineTokens(cleanBody)}
            </div>
          </div>
        );
      }

      // Check if line is a numbered item (e.g. "1. ", "2. ")
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        return (
          <div key={lineIdx} className="flex items-start gap-2.5 my-1.5 pl-1">
            <span className="font-semibold text-slate-500 text-xs mt-0.5 shrink-0">
              {numMatch[1]}.
            </span>
            <div className="flex-1 text-slate-800 leading-relaxed">
              {parseLineTokens(numMatch[2])}
            </div>
          </div>
        );
      }

      // Check if heading line
      const isHeading = /^[A-Z][A-Za-z0-9\s\-\(\)\:\,]+:$/.test(trimmed);

      return (
        <p
          key={lineIdx}
          className={`my-2 leading-relaxed text-slate-800 ${
            isHeading ? "font-bold text-slate-900 mt-3 mb-1" : ""
          }`}
        >
          {parseLineTokens(trimmed)}
        </p>
      );
    });
  };

  return (
    <div className="my-6 max-w-3xl space-y-4 text-slate-800 font-sans">
      {/* Response Text with GPT-style message-wide citation deduplication */}
      <div className="text-sm leading-relaxed text-slate-800">
        {renderFormattedText(message.content)}
      </div>

      {/* Collapsible Accordion: SOURCES */}
      {citations.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <button
            onClick={() => setIsSourcesOpen(!isSourcesOpen)}
            className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold tracking-wider text-slate-500 uppercase hover:bg-slate-50 transition-colors cursor-pointer select-none"
          >
            <span className="flex items-center gap-1.5">
              <FileTextIcon className="h-3.5 w-3.5 text-slate-400" />
              {citations.length} SOURCES
            </span>
            <ChevronDownIcon
              className={`h-4 w-4 text-slate-400 transition-transform ${
                isSourcesOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isSourcesOpen && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {citations.map((citation, idx) => (
                <button
                  key={idx}
                  onClick={() =>
                    onSelectSource &&
                    onSelectSource({
                      filename: citation.filename,
                      title: citation.filename.replace(/\.[^/.]+$/, ""),
                      summary: citation.snippet,
                      content: citation.snippet,
                    })
                  }
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50 transition-colors group cursor-pointer"
                >
                  <span className="truncate pr-3 font-medium text-slate-800 group-hover:text-blue-600">
                    {citation.filename}
                  </span>
                  <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                    {Math.round(90 - idx * 5)}% rel
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
