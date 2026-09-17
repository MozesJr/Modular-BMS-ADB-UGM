"use client";
import React from "react";
import Badge from "../ui/badge/Badge";
import { BoxIconLine, GroupIcon } from "@/icons";

const bmsDevicesData = [
  { id: 1, name: "GAMA BMS Pack Main Rack", serial: "GAMA-BMS-001", packs: 2, status: "Verified", voltage: "53.83V", temp: "26.5°C" },
  { id: 2, name: "Solar Storage Unit B", serial: "GAMA-BMS-002", packs: 1, status: "Verified", voltage: "26.91V", temp: "25.1°C" },
  { id: 3, name: "Backup Generator Node", serial: "GAMA-BMS-003", packs: 1, status: "Pending", voltage: "13.45V", temp: "24.0°C" },
];

export default function BmsActiveDevicesList() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6 shadow-sm">
      <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Active BMS Registered Devices</h3>
          <p className="text-xs text-gray-500">Daftar modul universal BMS yang terhubung ke jaringan sistem</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-400 uppercase">
              <th className="py-3 px-4">Device Name & ID</th>
              <th className="py-3 px-4">Configuration</th>
              <th className="py-3 px-4">Voltage</th>
              <th className="py-3 px-4">Temperature</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            {bmsDevicesData.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                <td className="py-3.5 px-4 font-medium text-gray-800 dark:text-white">
                  <div>{item.name}</div>
                  <span className="text-xs text-gray-400 font-mono">{item.serial}</span>
                </td>
                <td className="py-3.5 px-4 text-gray-500 flex items-center gap-1.5 pt-5">
                  <BoxIconLine className="size-4" /> {item.packs} Pack Active
                </td>
                <td className="py-3.5 px-4 font-semibold text-gray-800 dark:text-white">{item.voltage}</td>
                <td className="py-3.5 px-4 text-gray-600 dark:text-gray-300">{item.temp}</td>
                <td className="py-3.5 px-4">
                  <Badge size="sm" color={item.status === "Verified" ? "success" : "warning"}>
                    {item.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}