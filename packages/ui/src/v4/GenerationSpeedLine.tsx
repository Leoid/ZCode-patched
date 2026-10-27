import { memo, useEffect, useState } from "react";
import { generationSpeedPartLabel } from "@zcode/shared";
import type { AssistantTextRow } from "@zcode/shared/zcode-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { describeAssistantGenerationSpeed } from "./assistantGenerationSpeed.js";

// 流式阶段实时读数的刷新间隔；足够平滑又不过度重渲染。
const LIVE_REFRESH_MS = 500;

/**
 * 单条 assistant 回复下方的生成速度行：流式中显示实时估算（带 `~`），完成后显示精确值。
 * 自身门控——无可显示内容时渲染 null；实时时钟只在流式期间走动。
 */
export const GenerationSpeedLine = memo(function GenerationSpeedLine({
  row,
  className,
}: {
  row: AssistantTextRow;
  className?: string;
}) {
  const streaming = row.state === "streaming";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [streaming]);

  const display = describeAssistantGenerationSpeed(row, now);
  if (!display) return null;

  const text =
    display.kind === "final"
      ? display.parts.map(generationSpeedPartLabel).join(" · ")
      : [display.outputApprox ? `↓${display.outputApprox}` : null, display.decode, display.elapsed]
          .filter((segment): segment is string => Boolean(segment))
          .join(" · ");

  return (
    <div
      data-testid="generation-speed-line"
      className={cn("select-none text-ui-caption text-foreground-subtlest tabular-nums", className)}
    >
      {text}
    </div>
  );
});
