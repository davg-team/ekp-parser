import { Suspense } from "react";
import { EventsPage } from "@/components/EventsPage";

export default function Page() {
  return (
    <Suspense>
      <EventsPage />
    </Suspense>
  );
}
