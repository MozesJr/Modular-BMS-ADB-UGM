"use client";
import React from "react";
import Badge from "../ui/badge/Badge";
import { ArrowUpIcon, BoxIconLine, GroupIcon } from "@/icons";


export default function BmsSystemMetrics () {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
      {/* Item 1: Active Devices */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl dark:bg-emerald-500/10 dark:text-emerald-400">
            <BoxIconLine className="size-6" />
          </div>
          <Badge color="success">System OK</Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Active BMS Units</span>
          <div className="flex items-baseline justify-between mt-1">
            <h4 className="font-bold text-gray-900 text-title-sm dark:text-white">3 Units</h4>
            <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <ArrowUpIcon className="w-3 h-3" /> 100% Online
            </span>
          </div>
        </div>
      </div>

      {/* Item 2: Average State of Charge (SoC) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-blue-50 text-blue-600 rounded-xl dark:bg-blue-500/10 dark:text-blue-400">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <Badge color="info">LiFePO4</Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Average System SoC</span>
          <div className="flex items-baseline justify-between mt-1">
            <h4 className="font-bold text-gray-900 text-title-sm dark:text-white">84.2%</h4>
            <span className="text-xs text-gray-500">Optimal Range</span>
          </div>
        </div>
      </div>

      {/* Item 3: Total Power Output */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-amber-50 text-amber-600 rounded-xl dark:bg-amber-500/10 dark:text-amber-400">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <Badge color="warning">Discharging</Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Total Power Load</span>
          <div className="flex items-baseline justify-between mt-1">
            <h4 className="font-bold text-gray-900 text-title-sm dark:text-white">1,240 W</h4>
            <span className="text-xs text-amber-600 font-medium">Stable</span>
          </div>
        </div>
      </div>

      {/* Item 4: Collaborators / Active Users */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-center w-12 h-12 bg-purple-50 text-purple-600 rounded-xl dark:bg-purple-500/10 dark:text-purple-400">
            <GroupIcon className="size-6" />
          </div>
          <Badge color="light">Active</Badge>
        </div>
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Team Collaborators</span>
          <div className="flex items-baseline justify-between mt-1">
            <h4 className="font-bold text-gray-900 text-title-sm dark:text-white">8 Users</h4>
            <span className="text-xs text-gray-500">Shared Access</span>
          </div>
        </div>
      </div>
    </div>
  );
};