import DeviceList from "@/components/devices/DeviceList";

export const metadata = {
  title: "My Devices | Modular Universal BMS",
  description: "Kelola device BMS yang kamu miliki",
};

export default function DevicesPage() {
  return (
    <div>
      <DeviceList />
    </div>
  );
}
