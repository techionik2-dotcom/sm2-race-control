import { Suspense } from "react";

import SignoutClient from "./SignoutClient";

export default function AdminSignoutPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignoutClient />
    </Suspense>
  );
}
