"use client";

import { HTMLMotionProps, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface AnimatedButtonProps extends HTMLMotionProps<"button"> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export function AnimatedButton({
  children,
  className,
  variant = "primary",
  size = "md",
  isLoading = false,
  ...props
}: AnimatedButtonProps) {
  const baseStyles = "relative inline-flex items-center justify-center font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  
  const variants = {
    primary: "bg-[var(--a)] text-white hover:bg-[var(--a-mid)] shadow-[0_1px_2px_rgba(0,102,204,0.3)]",
    secondary: "bg-[var(--bg-3)] text-[var(--t-1)] hover:bg-[var(--line-1)] border border-[var(--line-1)]",
    ghost: "text-[var(--t-2)] hover:text-[var(--t-1)] hover:bg-[var(--bg-3)]",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs rounded-md",
    md: "h-10 px-4 text-sm rounded-lg",
    lg: "h-12 px-6 text-base rounded-xl",
    icon: "h-10 w-10 rounded-full",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      <span className={cn("inline-flex items-center justify-center", isLoading && "opacity-0")}>
        {children}
      </span>
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      )}
    </motion.button>
  );
}
