"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const LampContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "relative flex min-h-[16rem] w-full flex-col items-center justify-start overflow-hidden z-0",
        className,
      )}
      style={{
        background: "transparent",
      }}
    >
      <div className="relative flex h-28 w-full items-start justify-center isolate z-0">
        <motion.div
          initial={{ opacity: 0.5, width: "12rem" }}
          whileInView={{ opacity: 1, width: "30rem" }}
          transition={{ delay: 0.2, duration: 0.8, ease: "easeInOut" }}
          style={{
            backgroundImage:
              "conic-gradient(from 180deg at center top, transparent, var(--accent-soft), transparent)",
          }}
          className="absolute top-0 h-36 overflow-visible w-[30rem]"
        >
          <div
            className="absolute bottom-0 left-0 h-20 w-full z-20"
            style={{
              background: "var(--bg-page)",
              maskImage: "linear-gradient(to top, white, transparent)",
            }}
          />
        </motion.div>

        <div
          className="absolute top-10 z-40 h-16 w-[16rem] rounded-full blur-3xl"
          style={{ background: "var(--accent-glow)" }}
        />
        <motion.div
          initial={{ width: "8rem" }}
          whileInView={{ width: "18rem" }}
          transition={{ delay: 0.2, duration: 0.8, ease: "easeInOut" }}
          className="absolute top-4 z-50 h-[2px]"
          style={{ background: "var(--accent)", boxShadow: "var(--shadow-glow)" }}
        />
      </div>

      <div className="relative z-50 mt-2 flex flex-col items-center px-5">
        {children}
      </div>
    </div>
  );
};
