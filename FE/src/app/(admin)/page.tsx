import type { Metadata } from "next";
import FleetDashboard from "@/components/bms/FleetDashboard";

export const metadata: Metadata = {
  title: "GAMA BMS Dashboard - Fleet Overview",
  description: "Global monitoring dashboard for modular universal Battery Management Systems",
};

export default function BmsDashboard() {
  return <FleetDashboard />;
}
