import { EventDetails } from "@/components/EventDetails";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EventDetails id={decodeURIComponent((await params).id)} />;
}
