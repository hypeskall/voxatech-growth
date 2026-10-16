"use client";
import { Dialog as Primitive } from "radix-ui";
import { useRef } from "react";
import { X } from "lucide-react";
export function Modal({
  open,
  onOpenChange,
  title,
  description = "Completează câmpurile și confirmă modificările.",
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const previous = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="modal-overlay" />
        <Primitive.Content
          className="modal-content"
          onOpenAutoFocus={() => {
            previous.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            if (previous.current?.isConnected) {
              event.preventDefault();
              previous.current.focus({ preventScroll: true });
            }
          }}
        >
          <div className="modal-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <Primitive.Close className="icon-button" aria-label="Închide">
              <X size={20} />
            </Primitive.Close>
          </div>
          <Primitive.Description className="sr-only">
            {description}
          </Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
