"use client";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const previous = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="lead-drawer"
          onOpenAutoFocus={() => {
            previous.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(e) => {
            if (previous.current?.isConnected) {
              e.preventDefault();
              previous.current.focus();
            }
          }}
        >
          <div className="drawer-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                Contact, conversație și următorul pas.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              aria-label="Închide detaliile leadului"
            >
              <X size={20} />
            </Dialog.Close>
          </div>
          <div className="drawer-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
