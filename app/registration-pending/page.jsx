"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import "../login/Login.css";
import "../signup/Signup.css";

const TELEMETRY_BACKGROUND =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/racing-telemetry-bg-TCNJDDSXNs3PoAhwXNBQab.webp";
const CHECKERED_FLAG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/checkered-flag-icon-BK4bojoYYoDd6y4gzs53PF.webp";

function BrandFlag() {
  return (
    <div className="login-brand__flag" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CHECKERED_FLAG} alt="" className="login-brand__flag-image" />
    </div>
  );
}

export default function RegistrationPendingPage() {
  const router = useRouter();

  useEffect(() => {
    window.localStorage.removeItem("sm2_token");
    window.localStorage.removeItem("sm2_user");
  }, []);

  return (
    <div className="login-page">
      <div
        className="login-background"
        style={{ backgroundImage: `url('${TELEMETRY_BACKGROUND}')` }}
      />
      <div className="login-background__overlay" />
      <div className="login-background__grid" />
      <div className="login-background__glow login-background__glow--orange" />
      <div className="login-background__glow login-background__glow--teal" />

      <main className="login-shell signup-shell">
        <section className="login-hero" aria-label="SM-2 Race Control brand">
          <div className="login-hero__accent" />
          <BrandFlag />
          <h1 className="login-brand">
            <span className="login-brand__orange">SM</span>
            <span className="login-brand__white">-2</span>
          </h1>
          <p className="login-hero__title">RACE CONTROL</p>
          <p className="login-hero__subtitle">Account Request Submitted</p>
        </section>

        <section className="login-card signup-card registration-pending-card" aria-label="Pending approval confirmation">
          <div className="login-card__inner signup-card__inner registration-pending-card__inner">
            <div className="registration-pending-state">
              <div className="registration-pending-state__icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 8v5l3 2" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </div>
              <h2 className="registration-pending-state__title">Account Request Submitted</h2>
              <p className="registration-pending-state__text">
                Your account has been created successfully and is waiting for approval from the
                SM-2 Race Control owner.
              </p>
              <p className="registration-pending-state__text">
                You will be able to sign in once your account has been approved.
              </p>
              <div className="registration-pending-status">
                <span className="registration-pending-status__label">Status</span>
                <span className="registration-pending-status__badge">Pending Approval</span>
              </div>
              <button
                type="button"
                className="login-button registration-pending-button"
                onClick={() => router.push("/login")}
              >
                Back to Login
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
