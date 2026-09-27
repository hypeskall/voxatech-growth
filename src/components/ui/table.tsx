import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="table-scroll">
      <table className={cn("data-table", className)} {...props} />
    </div>
  );
}
