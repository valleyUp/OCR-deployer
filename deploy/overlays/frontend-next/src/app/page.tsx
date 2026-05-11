"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { UploadCloud, FileText, Settings, Download, Search } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <div className="flex h-screen w-full flex-col bg-[var(--bg-base)] overflow-hidden font-sans">
      
      {/* Top Navigation Bar */}
      <motion.header 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="flex h-14 items-center justify-between px-6 bg-white/60 backdrop-blur-md border-b border-[var(--line-1)] z-10"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--a)] text-white shadow-sm">
            <FileText size={18} strokeWidth={2} />
          </div>
          <h1 className="text-sm font-semibold text-[var(--t-1)] tracking-tight">OCR Deployer</h1>
        </div>
        <div className="flex items-center gap-3">
          <AnimatedButton variant="ghost" size="sm">
            <Settings size={16} className="mr-2" /> Settings
          </AnimatedButton>
          <AnimatedButton variant="primary" size="sm">
            New Task
          </AnimatedButton>
        </div>
      </motion.header>

      {/* Main 3-Column Shell */}
      <main className="flex flex-1 gap-4 p-4 overflow-hidden">
        
        {/* Left Column: Upload & Configuration */}
        <motion.aside 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1, type: "spring", stiffness: 200, damping: 25 }}
          className="flex w-[320px] flex-col gap-4 shrink-0"
        >
          <GlassCard className="flex-1 p-5 gap-6">
            <div>
              <h2 className="text-sm font-semibold text-[var(--t-1)] mb-4">Configuration</h2>
              <SegmentedControl options={["Pipeline", "Formula", "Table"]} />
            </div>

            <div className="flex-1">
              <h2 className="text-sm font-semibold text-[var(--t-1)] mb-4">Input</h2>
              
              {/* Elegant Upload Zone */}
              <motion.div 
                whileHover={{ scale: 1.01, borderColor: "var(--a)", backgroundColor: "var(--a-soft)" }}
                whileTap={{ scale: 0.98 }}
                className="relative flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed border-[var(--line-2)] bg-[var(--bg-base)] cursor-pointer transition-colors"
              >
                <div className="h-12 w-12 rounded-xl bg-[var(--a-soft)] text-[var(--a)] flex items-center justify-center mb-4">
                  <UploadCloud size={24} />
                </div>
                <p className="text-sm font-semibold text-[var(--t-1)]">Click or drag file to upload</p>
                <p className="text-xs text-[var(--t-2)] mt-2">Supports PDF, PNG, JPG</p>
              </motion.div>
            </div>
          </GlassCard>
        </motion.aside>

        {/* Center Column: Interactive Preview */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, type: "spring", stiffness: 200, damping: 25 }}
          className="flex-1 flex"
        >
          <GlassCard className="flex-1 flex flex-col relative overflow-hidden bg-[var(--bg-base)]/50">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-[var(--t-3)]">
                <Search size={48} strokeWidth={1} />
                <p className="text-sm font-medium">No document selected</p>
              </div>
            </div>

            {/* Placeholder for floating pill toolbar */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-[var(--line-2)] bg-white/85 px-4 py-2 shadow-lg backdrop-blur-xl transition-all hover:bg-white/95">
               <span className="text-xs font-medium text-[var(--t-2)] px-2">Preview Canvas Ready</span>
            </div>
          </GlassCard>
        </motion.div>

        {/* Right Column: OCR Results & Inspector */}
        <motion.aside 
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3, type: "spring", stiffness: 200, damping: 25 }}
          className="flex w-[380px] flex-col shrink-0"
        >
          <GlassCard className="flex-1 flex flex-col">
            <div className="p-4 border-b border-[var(--line-1)] flex items-center justify-between shrink-0">
              <h2 className="text-sm font-semibold text-[var(--t-1)]">Results Inspector</h2>
              <AnimatedButton variant="ghost" size="sm">
                <Download size={16} />
              </AnimatedButton>
            </div>

            <div className="p-3 shrink-0">
              <SegmentedControl options={["Markdown", "JSON", "Blocks"]} />
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              <div className="flex flex-col gap-3">
                {/* Skeleton Loaders */}
                {[...Array(4)].map((_, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + (i * 0.1) }}
                    className="h-20 w-full rounded-xl bg-black/[0.03] animate-pulse border border-[var(--line-1)]"
                  />
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.aside>

      </main>
    </div>
  );
}
