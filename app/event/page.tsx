"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { EventDetails } from "@/components/EventDetails";

// Статический экспорт: id мероприятия — в query (/event/?id=…), а не в пути.
function EventPage() {
  const id = useSearchParams()?.get("id") ?? "";
  return <EventDetails id={id} />;
}

export default function Page() {
  return (
    <Suspense>
      <EventPage />
    </Suspense>
  );
}
