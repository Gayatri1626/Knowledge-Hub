"use client";

import React from "react";
import DocumentList from "@/components/DocumentList";
import type { DrawerDocument } from "@/components/DocumentDrawer";

interface DocumentsPageProps {
  onSelectDocument?: (doc: DrawerDocument) => void;
}

export default function DocumentsPage({ onSelectDocument }: DocumentsPageProps) {
  return (
    <div className="h-full w-full">
      <DocumentList onSelectDocument={onSelectDocument} />
    </div>
  );
}
