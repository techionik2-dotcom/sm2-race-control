"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "../context/AuthContext";

export default function AdminPortalEntry() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }

    const currentRole = String(user?.role || "").toUpperCase();
    const hasOwnerAccess = currentRole === "OWNER";

    router.replace(hasOwnerAccess ? "/admin/users" : "/login");
  }, [loading, router, user]);

  return null;
}
