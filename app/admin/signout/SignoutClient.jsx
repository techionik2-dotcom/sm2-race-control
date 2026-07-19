"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "../../context/AuthContext";
import "../../login/Login.css";

const TELEMETRY_BACKGROUND =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/racing-telemetry-bg-TCNJDDSXNs3PoAhwXNBQab.webp";
const CHECKERED_FLAG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/checkered-flag-icon-BK4bojoYYoDd6y4gzs53PF.webp";

const resolveNextPath = (value) => {
  if (typeof value !== "string") {
    return "/login";
  }

  const nextPath = value.trim();
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/login";
  }

  if (nextPath.startsWith("/admin/login")) {
    return "/login";
  }

  return nextPath;
};

const formatRoleLabel = (role) => {
  const normalized = String(role || "").toUpperCase();
  return normalized ? `${normalized.charAt(0)}${normalized.slice(1).toLowerCase()}` : "";
};

function BrandFlag() {
  return (
    <div className="login-brand__flag" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CHECKERED_FLAG} alt="" className="login-brand__flag-image" />
    </div>
  );
}

function LoadingIcon() {
  return (
    <svg className="login-button__spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="login-button__spinner-track" cx="12" cy="12" r="8.5" />
      <path className="login-button__spinner-path" d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5" />
    </svg>
  );
}

function AlertIcon({ tone = "error" }) {
  const colorClass =
    tone === "success" ? "login-alert__icon login-alert__icon--success" : "login-alert__icon";

  return (
    <svg
      className={colorClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tone === "success" ? (
        <>
          <path d="m9 12 2 2 4-5" />
          <circle cx="12" cy="12" r="9" />
        </>
      ) : (
        <>
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 4.5h3.4L21 17.5a1.8 1.8 0 0 1-1.6 2.7H4.6A1.8 1.8 0 0 1 3 17.5L10.3 4.5Z" />
        </>
      )}
    </svg>
  );
}

export default function SignoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { logout, user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(true);
  const [signoutMessage, setSignoutMessage] = useState("Ending the current portal session...");
  const [nextPath, setNextPath] = useState("/login");
  const [sessionUser, setSessionUser] = useState(user);
  const startedRef = useRef(false);

  const backgroundStyle = useMemo(
    () => ({
      backgroundImage: `url('${TELEMETRY_BACKGROUND}')`,
    }),
    [],
  );

  useEffect(() => {
    setSessionUser(user);
  }, [user]);

  useEffect(() => {
    if (startedRef.current) {
      return undefined;
    }

    startedRef.current = true;

    const desiredNext = resolveNextPath(searchParams.get("next"));
    setNextPath(desiredNext);

    let redirectTimer = null;

    const executeLogout = async () => {
      const result = await logout();
      const wasSuccessful = Boolean(result?.success);

      setIsSigningOut(false);
      setSignoutMessage(
        wasSuccessful
          ? "Session cleared and token revoked successfully."
          : "Session cleared locally. The token could not be revoked on the server.",
      );

      redirectTimer = window.setTimeout(() => {
        router.replace(desiredNext);
      }, 1800);
    };

    executeLogout();

    return () => {
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
      }
    };
  }, [logout, router, searchParams]);

  return (
    <div className="login-page">
      <div className="login-background" style={backgroundStyle} />
      <div className="login-background__overlay" />
      <div className="login-background__grid" />
      <div className="login-background__glow login-background__glow--orange" />
      <div className="login-background__glow login-background__glow--teal" />

      <main className="login-shell">
        <section className="login-hero" aria-label="SM-2 Race Control brand">
          <div className="login-hero__accent" />
          <BrandFlag />
          <h1 className="login-brand">
            <span className="login-brand__orange">SM</span>
            <span className="login-brand__white">-2</span>
          </h1>
          <p className="login-hero__title">RACE CONTROL</p>
          <p className="login-hero__subtitle">Owner Portal Sign Out</p>
        </section>

        <section className="login-card" aria-label="Sign out status">
          <div className="login-card__inner">
            <div className="login-state">
              {isSigningOut ? <LoadingIcon /> : <AlertIcon tone="success" />}
              <h2 className="login-state__title">
                {isSigningOut ? "Signing you out" : "Signed out successfully"}
              </h2>
              <p className="login-state__text">{signoutMessage}</p>

              {sessionUser ? (
                <div className="login-alert" style={{ marginTop: "0.5rem" }}>
                  <AlertIcon tone="success" />
                  <div className="login-alert__copy">
                    <p className="login-alert__title">Session closed for</p>
                    <p className="login-alert__text">
                      {sessionUser.name || sessionUser.email} · {formatRoleLabel(sessionUser.role)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div
                style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}
              >
                <button
                  type="button"
                  className="login-button"
                  onClick={() => router.replace(nextPath)}
                  style={{ minWidth: "14rem" }}
                >
                  Return to Login
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="login-cta" aria-label="Post logout note">
          <p className="login-cta__text">
            The portal will redirect automatically. If it does not, use the button above.
          </p>
        </section>

      </main>
    </div>
  );
}
