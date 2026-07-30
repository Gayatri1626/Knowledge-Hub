"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import NewDomainModal from "./NewDomainModal";
import DocumentDrawer, { type DrawerDocument } from "./DocumentDrawer";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [selectedDrawerDoc, setSelectedDrawerDoc] = useState<DrawerDocument | null>(null);

  const isUploadPage = pathname === "/upload";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* Left DOMAINS Sidebar (hidden on upload page if full page, or present on main pages) */}
      {!isUploadPage && <Sidebar />}

      {/* Main Container */}
      <div className="flex flex-1 flex-col min-w-0 h-full relative">
        <TopBar />
        <main className="flex-1 min-h-0 relative flex flex-col bg-white">
          {/* Inject drawer trigger helper via React clone or props if needed */}
          {React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<any>, {
                onSelectDocument: (doc: DrawerDocument) => setSelectedDrawerDoc(doc),
              })
            : children}
        </main>

        {/* Slide-out Document Drawer */}
        <DocumentDrawer
          document={selectedDrawerDoc}
          onClose={() => setSelectedDrawerDoc(null)}
        />
      </div>

      {/* New Domain Modal */}
      <NewDomainModal />
    </div>
  );
}
