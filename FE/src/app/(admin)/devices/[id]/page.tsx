// FE/src/app/(admin)/devices/[id]/page.tsx
import DeviceDetail from "@/components/devices/DeviceDetail";

export const metadata = {
  title: "Detail Device | Modular Universal BMS",
};

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeviceDetail deviceId={id} />;
}
