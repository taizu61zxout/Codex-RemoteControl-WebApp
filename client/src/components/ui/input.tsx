import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/10 bg-[#141a20] px-3 py-2 text-sm text-stone-100 shadow-sm outline-none transition placeholder:text-stone-500 focus-visible:border-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300/20",
        className
      )}
      {...props}
    />
  );
}
