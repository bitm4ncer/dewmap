"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { CredentialsModal } from "@/components/CredentialsModal";
import { clearCredentials, loadCredentials, saveCredentials } from "@/lib/sentinel/auth";
import type { Credentials } from "@/types/sentinel";

const LiveMap = dynamic(() => import("@/components/Map").then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-[color:var(--ink-mute)]">
      Loading map…
    </div>
  ),
});

export default function Home() {
  const [creds, setCreds] = useState<Credentials | null>(() =>
    loadCredentials(),
  );
  const [showModal, setShowModal] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Deep link: /?settings=1 opens the credentials modal directly.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("settings");
    if (value !== null && value !== "0" && value !== "false") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only query param, read once after mount
      setShowModal(true);
    }
  }, []);

  // Returning focus to the gear keeps the keyboard path intact after closing.
  // Safari does not focus buttons on click, so fall back to the trigger itself.
  useEffect(() => {
    if (showModal) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      return;
    }
    const trigger =
      triggerRef.current ??
      document.querySelector<HTMLElement>('[aria-label="Open settings"]');
    triggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus();
  }, [showModal]);

  function handleSave(c: Credentials) {
    saveCredentials(c);
    setCreds(c);
    setShowModal(false);
  }

  function handleReset() {
    clearCredentials();
    setCreds(null);
    setShowModal(false);
  }

  return (
    <div className="fixed inset-0">
      <LiveMap
        credentials={creds}
        onOpenSettings={() => setShowModal(true)}
      />

      {showModal && (
        <CredentialsModal
          initial={creds}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
          onClear={creds ? handleReset : undefined}
        />
      )}
    </div>
  );
}
