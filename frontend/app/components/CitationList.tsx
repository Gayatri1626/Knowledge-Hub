import type { Citation } from "@/lib/api";

interface GroupedSource {
  filename: string;
  documentId: string;
  pages: (number | null)[];
  /** The lowest citation number in this group — used only for stable ordering. */
  firstN: number;
}

/**
 * Groups citations by document and deduplicates.
 * Shows each source document once with its referenced page numbers.
 */
function groupByDocument(citations: Citation[]): GroupedSource[] {
  const map = new Map<string, GroupedSource>();

  for (const c of citations) {
    const existing = map.get(c.document_id);
    if (existing) {
      if (c.page_number !== null && !existing.pages.includes(c.page_number)) {
        existing.pages.push(c.page_number);
      }
    } else {
      map.set(c.document_id, {
        filename: c.filename,
        documentId: c.document_id,
        pages: c.page_number !== null ? [c.page_number] : [],
        firstN: c.n,
      });
    }
  }

  const groups = Array.from(map.values());
  // Sort pages numerically within each group
  for (const g of groups) {
    g.pages.sort((a, b) => (a ?? 0) - (b ?? 0));
  }
  // Sort groups by first citation number so order matches the answer
  groups.sort((a, b) => a.firstN - b.firstN);
  return groups;
}

export default function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  const groups = groupByDocument(citations);

  return (
    <div className="mt-3 border-t border-white/[0.08] pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
        Sources
      </p>
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => {
          const pageLabel =
            group.pages.length > 0
              ? ` · p.${group.pages.join(", ")}`
              : "";

          return (
            <span
              key={group.documentId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 transition-colors hover:border-white/15 hover:bg-white/[0.07]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3 w-3 shrink-0 text-blue-400/70"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.94 2.439A1.5 1.5 0 0 0 8.878 2H4Zm4 3.5a.75.75 0 0 1 .75.75v2.69l.72-.72a.75.75 0 1 1 1.06 1.06l-2 2a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 0 1 1.06-1.06l.72.72V6.25A.75.75 0 0 1 8 5.5Z"
                  clipRule="evenodd"
                />
              </svg>
              {group.filename}
              {pageLabel && (
                <span className="text-white/40">{pageLabel}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
