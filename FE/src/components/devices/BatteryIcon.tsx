import React from "react";

export type DeviceVerificationStatus = "verified" | "pending";

export const STATUS_LEVEL_MAP: Record<DeviceVerificationStatus, number> = {
  verified: 100,
  pending: 35,
};

export const STATUS_FILL_COLOR_MAP: Record<DeviceVerificationStatus, string> = {
  verified: "text-emerald-500 dark:text-emerald-400",
  pending: "text-amber-500 dark:text-amber-400",
};

interface BatteryIconProps {
  status: DeviceVerificationStatus;
  level?: number;
  size?: number;
  className?: string;
}

const BODY_X = 2;
const BODY_Y = 3;
const BODY_WIDTH = 22;
const BODY_HEIGHT = 12;
const BODY_PADDING = 2;

export default function BatteryIcon({
  status,
  level,
  size = 24,
  className = "",
}: BatteryIconProps) {
  const resolvedLevel = Math.max(0, Math.min(100, level ?? STATUS_LEVEL_MAP[status]));
  const fillMaxWidth = BODY_WIDTH - BODY_PADDING * 2;
  const fillWidth = (fillMaxWidth * resolvedLevel) / 100;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x={BODY_X}
        y={BODY_Y}
        width={BODY_WIDTH}
        height={BODY_HEIGHT}
        rx={2.5}
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-gray-300 dark:text-gray-700"
      />
      <rect
        x={BODY_X + BODY_WIDTH + 1}
        y={BODY_Y + 4}
        width={2}
        height={4}
        rx={1}
        fill="currentColor"
        className="text-gray-300 dark:text-gray-700"
      />
      {resolvedLevel > 0 && (
        <rect
          x={BODY_X + BODY_PADDING}
          y={BODY_Y + BODY_PADDING}
          width={fillWidth}
          height={BODY_HEIGHT - BODY_PADDING * 2}
          rx={1}
          fill="currentColor"
          className={STATUS_FILL_COLOR_MAP[status]}
        />
      )}
    </svg>
  );
}