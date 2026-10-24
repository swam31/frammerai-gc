"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export const Tooltip = ({
  content,
  children,
  containerClassName,
  panelClassName,
  contentClassName,
}: {
  content: string | React.ReactNode;
  children: React.ReactNode;
  containerClassName?: string;
  panelClassName?: string;
  contentClassName?: string;
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [height, setHeight] = useState(0);
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMounted = typeof document !== "undefined";

  useEffect(() => {
    if (isVisible && contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [isVisible, content]);

  const calculatePosition = (clientX: number, clientY: number) => {
    if (!contentRef.current) {
      return { x: clientX + 12, y: clientY + 12 };
    }

    const tooltip = contentRef.current;
    const tooltipContainer = tooltip.parentElement as HTMLElement | null;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const tooltipWidth =
      tooltipContainer?.offsetWidth ?? Math.max(240, tooltip.scrollWidth + 16);
    const tooltipHeight =
      tooltipContainer?.offsetHeight ?? Math.max(80, tooltip.scrollHeight);

    const containerRect = containerRef.current?.getBoundingClientRect();
    let finalX = clientX + 12;
    let finalY = clientY + 12;

    // Prefer opening to the right side of the trigger.
    if (containerRect) {
      finalX = containerRect.right + 16;
      finalY = containerRect.top;
    }

    if (finalX + tooltipWidth > viewportWidth - 12) {
      finalX = containerRect
        ? containerRect.left - tooltipWidth - 16
        : clientX - tooltipWidth - 12;
    }
    if (finalX + tooltipWidth > viewportWidth - 12) {
      finalX = viewportWidth - tooltipWidth - 12;
    }
    if (finalX < 12) {
      finalX = 12;
    }
    if (finalY + tooltipHeight > viewportHeight - 12) {
      finalY = clientY - tooltipHeight - 12;
    }
    if (finalY < 12) {
      finalY = 12;
    }

    return { x: finalX, y: finalY };
  };

  const updateMousePosition = (clientX: number, clientY: number) => {
    setMouse({ x: clientX, y: clientY });
    setPosition(calculatePosition(clientX, clientY));
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsVisible(true);
    updateMousePosition(e.clientX, e.clientY);
  };

  const handleMouseLeave = () => {
    setMouse({ x: 0, y: 0 });
    setPosition({ x: 0, y: 0 });
    setIsVisible(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isVisible) return;
    updateMousePosition(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    updateMousePosition(touch.clientX, touch.clientY);
    setIsVisible(true);
  };

  const handleTouchEnd = () => {
    setTimeout(() => {
      setIsVisible(false);
      setMouse({ x: 0, y: 0 });
      setPosition({ x: 0, y: 0 });
    }, 2000);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(hover: none)").matches) {
      e.preventDefault();
      if (isVisible) {
        setIsVisible(false);
        setMouse({ x: 0, y: 0 });
        setPosition({ x: 0, y: 0 });
      } else {
        updateMousePosition(e.clientX, e.clientY);
        setIsVisible(true);
      }
    }
  };

  useEffect(() => {
    if (isVisible && contentRef.current) {
      const frame = requestAnimationFrame(() => {
        setPosition(calculatePosition(mouse.x, mouse.y));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isVisible, height, mouse.x, mouse.y]);

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block", containerClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      {children}
      {isMounted &&
        createPortal(
          <AnimatePresence>
            {isVisible && (
              <motion.div
                key={String(isVisible)}
                initial={{ height: 0, opacity: 1 }}
                animate={{ height, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                className={cn(
                  "pointer-events-none fixed z-[9999] min-w-[22rem] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-solid)] shadow-lg ring-1 ring-[var(--border-default)]",
                  panelClassName,
                )}
                style={{ top: position.y, left: position.x }}
              >
                <div
                  ref={contentRef}
                  className={cn(
                    "p-2 text-sm text-[var(--text-secondary)] md:p-4",
                    contentClassName,
                  )}
                >
                  {content}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
};
