"use client";

import React from "react";
import { Tooltip } from "@/components/ui/tooltip-card";

export default function TooltipCardDemo() {
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-10">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        There was a problem with the server. Once{" "}
        <Tooltip
          containerClassName="text-neutral-600 dark:text-neutral-400"
          content="AWS markets itself as the world's most comprehensive cloud platform."
        >
          <span className="font-bold">AWS</span>
        </Tooltip>{" "}
        went down, we had to quickly migrate to a new provider.
      </p>
    </div>
  );
}
