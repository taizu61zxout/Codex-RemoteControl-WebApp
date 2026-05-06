import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[120px] w-full rounded-2xl border border-white/10 bg-[#141a20] px-4 py-3 text-sm text-stone-100 shadow-sm outline-none transition placeholder:text-stone-500 focus-visible:border-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300/20",
        className
      )}
      {...props}
    />
  );
});
