"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  requireOwner = false,
  requireDriver = false,
  requireAdmin = false,
  requireMechanic = false,
}) {
  const router = useRouter();
  const { user, loading, isOwner, isDriver } = useAuth();
  const ownerRequired = requireOwner || requireAdmin;
  const driverRequired = requireDriver || requireMechanic;

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    if (ownerRequired && !isOwner()) {
      router.push("/login?access=denied");
      return;
    }

    if (driverRequired && !isDriver()) {
      router.push("/login?access=denied");
      return;
    }
  }, [user, loading, ownerRequired, driverRequired, isOwner, isDriver, router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-primary)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            color: "var(--color-text)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🏁</div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (ownerRequired && !isOwner()) {
    return null;
  }

  if (driverRequired && !isDriver()) {
    return null;
  }

  return <>{children}</>;
}
