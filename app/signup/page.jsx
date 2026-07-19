"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerUser } from "../utils/authApi";
import "../login/Login.css";
import "./Signup.css";

const CHECKERED_FLAG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/checkered-flag-icon-BK4bojoYYoDd6y4gzs53PF.webp";

function SignupIcon({ type }) {
  const content =
    type === "user" ? (
      <>
        <circle cx="12" cy="8" r="3.1" />
        <path d="M5.5 19c0-3.6 2.95-6 6.5-6s6.5 2.4 6.5 6" />
      </>
    ) : type === "mail" ? (
      <>
        <path d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25V6.75Z" />
        <path d="m6 7.5 6 4.5 6-4.5" />
      </>
    ) : (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8.5 10V8.25A3.5 3.5 0 0 1 12 4.75a3.5 3.5 0 0 1 3.5 3.5V10" />
      </>
    );

  return (
    <svg
      className="login-input__icon signup-input__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}

function BackLink({ onClick }) {
  return (
    <button type="button" className="signup-backlink" onClick={onClick}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      Back to Login
    </button>
  );
}

function BrandFlag() {
  return (
    <div className="login-brand__flag" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CHECKERED_FLAG} alt="" className="login-brand__flag-image" />
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="login-button__arrow signup-button__arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export default function Signup() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const firstNameInputRef = useRef(null);
  const lastNameInputRef = useRef(null);
  const emailInputRef = useRef(null);
  const teamNameInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);

  const fullName = useMemo(
    () => `${firstName} ${lastName}`.trim().replace(/\s+/g, " "),
    [firstName, lastName]
  );

  const passwordRules = useMemo(
    () => [
      {
        label: "At least 8 characters",
        valid: password.length >= 8,
      },
      {
        label: "Uppercase and lowercase letters",
        valid: /[a-z]/.test(password) && /[A-Z]/.test(password),
      },
      {
        label: "At least one number",
        valid: /\d/.test(password),
      },
    ],
    [password]
  );

  const clearAutofilledInputs = useCallback(() => {
    const fields = [
      [firstNameInputRef, firstName],
      [lastNameInputRef, lastName],
      [emailInputRef, email],
      [teamNameInputRef, teamName],
      [passwordInputRef, password],
      [confirmPasswordInputRef, confirmPassword],
    ];

    fields.forEach(([ref, value]) => {
      const element = ref.current;
      if (element && !value && element.value) {
        element.value = "";
      }
    });
  }, [confirmPassword, email, firstName, lastName, password, teamName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    clearAutofilledInputs();

    const frameId = window.requestAnimationFrame(clearAutofilledInputs);
    const timeoutId = window.setTimeout(clearAutofilledInputs, 300);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [clearAutofilledInputs]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setError("Please fill in all required fields.");
      setIsLoading(false);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setIsLoading(false);
      return;
    }

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError("Password must be 8+ characters and include uppercase, lowercase, and a number.");
      setIsLoading(false);
      return;
    }

    if (!termsAccepted) {
      setError("Please accept the terms and privacy policy.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await registerUser({
        name: fullName,
        email,
        password,
        teamName,
      });

      if (response?.success && response?.user) {
        window.location.replace("/registration-pending");
        return;
      }

      setError(response?.message || "Failed to create user.");
    } catch (signupError) {
      console.error("Signup error:", signupError);
      setError(
        signupError?.message ||
          signupError?.error ||
          "Failed to create user. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div
        className="login-background"
        style={{
          backgroundImage:
            "url('https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/racing-telemetry-bg-TCNJDDSXNs3PoAhwXNBQab.webp')",
        }}
      />
      <div className="login-background__overlay" />
      <div className="login-background__grid" />
      <div className="login-background__glow login-background__glow--orange" />
      <div className="login-background__glow login-background__glow--teal" />

      <main className="login-shell signup-shell">
        <div className="signup-topbar">
          <BackLink onClick={() => router.push("/login")} />
        </div>

        <section className="login-hero" aria-label="SM-2 Race Control brand">
          <div className="login-hero__accent" />
          <BrandFlag />
          <h1 className="login-brand">
            <span className="login-brand__orange">SM</span>
            <span className="login-brand__white">-2</span>
          </h1>
          <p className="login-hero__title">RACE CONTROL</p>
          <p className="login-hero__subtitle">Create Your Account</p>
          <p className="signup-hero__caption">
            Request access to SM-2 Race Control. An owner will review and approve the account.
          </p>
        </section>

        <section className="login-card signup-card" aria-label="Create account form">
          <div className="login-card__inner signup-card__inner">
            <form onSubmit={handleSubmit} className="login-form signup-form" autoComplete="off">
              {error && (
                <div className="login-alert" role="alert">
                  <svg
                    className="login-alert__icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <path d="M10.3 4.5h3.4L21 17.5a1.8 1.8 0 0 1-1.6 2.7H4.6A1.8 1.8 0 0 1 3 17.5L10.3 4.5Z" />
                  </svg>
                  <div className="login-alert__copy">
                    <p className="login-alert__title">Account creation issue</p>
                    <p className="login-alert__text">{error}</p>
                  </div>
                </div>
              )}

              <div className="signup-name-grid">
                <div className="login-field">
                  <label htmlFor="firstName" className="login-field__label">
                    First Name
                  </label>
                  <div className="login-field__control">
                    <SignupIcon type="user" />
                    <input
                      ref={firstNameInputRef}
                      type="text"
                      id="firstName"
                      name="signup-first-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Enter first name"
                      className="login-input"
                      autoComplete="off"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label htmlFor="lastName" className="login-field__label">
                    Last Name
                  </label>
                  <div className="login-field__control">
                    <SignupIcon type="user" />
                    <input
                      ref={lastNameInputRef}
                      type="text"
                      id="lastName"
                      name="signup-last-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Enter last name"
                      className="login-input"
                      autoComplete="off"
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="email" className="login-field__label">
                  Email Address
                </label>
                <div className="login-field__control">
                  <SignupIcon type="mail" />
                  <input
                    ref={emailInputRef}
                    type="email"
                    id="email"
                    name="signup-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    className="login-input"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    inputMode="email"
                    spellCheck="false"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="teamName" className="login-field__label">
                  Team Name <span className="signup-field__optional">(Optional)</span>
                </label>
                <div className="login-field__control">
                  <SignupIcon type="user" />
                  <input
                    ref={teamNameInputRef}
                    type="text"
                    id="teamName"
                    name="signup-team-name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="Enter team name"
                    className="login-input"
                    autoComplete="off"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="login-field">
                <div className="login-field__header">
                  <label htmlFor="password" className="login-field__label">
                    Password
                  </label>
                </div>
                <div className="login-field__control">
                  <SignupIcon type="lock" />
                  <input
                    ref={passwordInputRef}
                    type="password"
                    id="password"
                    name="signup-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="login-input"
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                </div>
                <ul className="signup-password-rules" aria-label="Password requirements">
                  {passwordRules.map((rule) => (
                    <li key={rule.label} className={rule.valid ? "is-valid" : ""}>
                      <span className="signup-password-rules__dot" aria-hidden="true" />
                      {rule.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="login-field">
                <label htmlFor="confirmPassword" className="login-field__label">
                  Confirm Password
                </label>
                <div className="login-field__control">
                  <SignupIcon type="lock" />
                  <input
                    ref={confirmPasswordInputRef}
                    type="password"
                    id="confirmPassword"
                    name="signup-confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="login-input"
                    autoComplete="new-password"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <label className="signup-terms">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="signup-terms__checkbox"
                  disabled={isLoading}
                />
                <span>
                  I agree to the{" "}
                  <button type="button" className="signup-terms__link">
                    Terms and Conditions
                  </button>{" "}
                  and{" "}
                  <button type="button" className="signup-terms__link">
                    Privacy Policy
                  </button>
                </span>
              </label>

              <button
                type="submit"
                className="login-button signup-button"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="signup-button__label">Submitting<br />Request...</span>
                ) : (
                  <span className="signup-button__label">Request<br />Access</span>
                )}
                {!isLoading && <ArrowIcon />}
              </button>
            </form>
          </div>
        </section>

        <section className="login-cta signup-cta" aria-label="Login link">
          <p className="login-cta__text">
            Already have an account?{" "}
            <button
              type="button"
              className="login-cta__link"
              onClick={() => router.push("/login")}
            >
              Sign In
            </button>
          </p>
        </section>

      </main>
    </div>
  );
}
