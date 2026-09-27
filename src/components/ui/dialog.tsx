"use client";
import { Dialog as Primitive } from "radix-ui";
import { X } from "lucide-react";
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="modal-overlay" />
        <Primitive.Content className="modal-content">
          <div className="modal-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <Primitive.Close className="icon-button" aria-label="Închide">
              <X size={20} />
            </Primitive.Close>
          </div>
          <Primitive.Description className="sr-only">
            Completează câmpurile și confirmă modificările.
          </Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
