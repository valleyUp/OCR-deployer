"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface SegmentedControlProps {
  options: string[];
  defaultSelected?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export function SegmentedControl({
  options,
  defaultSelected,
  onChange,
  className,
}: SegmentedControlProps) {
  const [selected, setSelected] = useState(defaultSelected || options[0]);

  const handleSelect = (option: string) => {
    setSelected(option);
    if (onChange) onChange(option);
  };

  return (
    <div
      className={cn(
        "relative flex items-center p-1 bg-[var(--bg-base)] rounded-xl shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)]",
        className
      )}
    >
      {options.map((option) => {
        const isSelected = selected === option;

        return (
          <button
            key={option}
            onClick={() => handleSelect(option)}
            className={cn(
              "relative flex-1 py-1.5 px-3 text-sm font-medium transition-colors z-10",
              isSelected ? "text-[var(--t-1)]" : "text-[var(--t-2)] hover:text-[var(--t-1)]"
            )}
          >
            <span className="relative z-20">{option}</span>
            {isSelected && (
              <motion.div
                layoutId={`segmented-control-bg-${options.join("-")}`}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute inset-0 z-0 bg-white rounded-lg shadow-sm border border-black/5"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
