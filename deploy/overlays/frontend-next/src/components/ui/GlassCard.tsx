"use client";

import { HTMLMotionProps, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function GlassCard({ children, className, delay = 0, ...props }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 24,
        delay,
      }}
      className={cn(
        "relative flex flex-col overflow-hidden",
        "bg-white/85 backdrop-blur-xl",
        "border border-black/5 shadow-sm rounded-2xl",
        className
      )}
      {...props}
    >
      {/* Subtle inner highlight to simulate 3D glass edge */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-white/40" />
      {children}
    </motion.div>
  );
}
