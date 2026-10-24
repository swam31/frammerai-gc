"use client";

import { cn } from "@/lib/utils";
import { useMotionValue, motion, useMotionTemplate } from "framer-motion";
import React from "react";

export const HeroHighlight = ({
  children,
  className,
  containerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const dotPatterns = {
    light: {
      default:
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='16' height='16' fill='none'%3E%3Ccircle fill='%23d9b0b0' id='pattern-circle' cx='10' cy='10' r='2.2'%3E%3C/circle%3E%3C/svg%3E\")",
      hover:
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='16' height='16' fill='none'%3E%3Ccircle fill='%23dc2626' id='pattern-circle' cx='10' cy='10' r='2.2'%3E%3C/circle%3E%3C/svg%3E\")",
    },
    dark: {
      default:
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='16' height='16' fill='none'%3E%3Ccircle fill='%235f3d3d' id='pattern-circle' cx='10' cy='10' r='2.2'%3E%3C/circle%3E%3C/svg%3E\")",
      hover:
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='16' height='16' fill='none'%3E%3Ccircle fill='%23ef4444' id='pattern-circle' cx='10' cy='10' r='2.2'%3E%3C/circle%3E%3C/svg%3E\")",
    },
  };

  function handleMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: React.MouseEvent<HTMLDivElement>) {
    if (!currentTarget) return;
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn(
        "group relative flex h-[16rem] w-full items-center justify-center overflow-hidden rounded-xl",
        containerClassName,
      )}
      style={{ background: "transparent" }}
      onMouseMove={handleMouseMove}
    >
      <div
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{ backgroundImage: dotPatterns.light.default }}
      />
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{ backgroundImage: dotPatterns.dark.default }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 dark:hidden"
        style={{
          backgroundImage: dotPatterns.light.hover,
          WebkitMaskImage: useMotionTemplate`
            radial-gradient(200px circle at ${mouseX}px ${mouseY}px, black 0%, transparent 100%)
          `,
          maskImage: useMotionTemplate`
            radial-gradient(200px circle at ${mouseX}px ${mouseY}px, black 0%, transparent 100%)
          `,
        }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 hidden opacity-0 transition duration-300 group-hover:opacity-100 dark:block"
        style={{
          backgroundImage: dotPatterns.dark.hover,
          WebkitMaskImage: useMotionTemplate`
            radial-gradient(200px circle at ${mouseX}px ${mouseY}px, black 0%, transparent 100%)
          `,
          maskImage: useMotionTemplate`
            radial-gradient(200px circle at ${mouseX}px ${mouseY}px, black 0%, transparent 100%)
          `,
        }}
      />

      <div className={cn("relative z-20 w-full", className)}>{children}</div>
    </div>
  );
};

export const Highlight = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <motion.span
      initial={{ backgroundSize: "0% 100%" }}
      animate={{ backgroundSize: "100% 100%" }}
      transition={{ duration: 1.2, ease: "linear", delay: 0.2 }}
      style={{
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        display: "inline-flex",
        backgroundImage:
          "linear-gradient(to right, var(--accent-soft), var(--accent))",
        lineHeight: 1,
      }}
      className={cn(
        "relative mx-1 inline-flex items-center whitespace-nowrap rounded-full px-4 py-1.5 align-middle",
        className,
      )}
    >
      {children}
    </motion.span>
  );
};
