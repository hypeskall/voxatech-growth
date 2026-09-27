import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants = cva("button", {
  variants: {
    variant: {
      default: "primary",
      secondary: "secondary",
      ghost: "ghost",
      destructive: "danger",
    },
    size: { default: "", sm: "small", icon: "icon-button" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp className={cn(variants({ variant, size }), className)} {...props} />
  );
}
