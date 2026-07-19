"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "../context/AuthContext";
import { loginUser } from "../utils/authApi";
import "./Login.css";

const TELEMETRY_BACKGROUND =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/racing-telemetry-bg-TCNJDDSXNs3PoAhwXNBQab.webp";
const CHECKERED_FLAG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663611619053/EBPeWtZXBpCFLD2Dqq5aDH/checkered-flag-icon-BK4bojoYYoDd6y4gzs53PF.webp";

const hasOwnerAccess = (role) => ["OWNER", "ADMIN"].includes(String(role || "").toUpperCase());
const getPostLoginRoute = (role) => (hasOwnerAccess(role) ? "/admin/users" : "/events");

const isHtmlLikeError = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  return (
    text.startsWith("<!DOCTYPE html") ||
    text.startsWith("<html") ||
    text.includes("__next_f") ||
    text.includes("This page could not be found")
  );
};

const safeErrorMessage = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const text = value.trim();
  if (!text || isHtmlLikeError(text)) {
    return fallback;
  }

  return text;
};

function LoginInputIcon({ type }) {
  const path =
    type === "mail" ? (
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
      className="login-input__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

function PasswordVisibilityIcon({ visible }) {
  return (
    <svg
      className="login-password-toggle__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible ? <path d="M4 4l16 16" /> : null}
    </svg>
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

function ArrowIcon() {
  return (
    <svg
      className="login-button__arrow"
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

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [successTitle, setSuccessTitle] = useState("");
  const [accessNotice, setAccessNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user } = useAuth();

  const backgroundStyle = useMemo(
    () => ({
      backgroundImage: `url('${TELEMETRY_BACKGROUND}')`,
    }),
    [],
  );

  useEffect(() => {
    const signupState = searchParams.get("signup");
    const accessStatus = searchParams.get("access");

    if (signupState === "pending" || signupState === "success") {
      setSuccessTitle("Request submitted");
      setSuccess(
        "Your account request has been sent to an owner for approval. You can sign in after the request is approved.",
      );
      router.replace("/login", { scroll: false });
      const timer = window.setTimeout(() => {
        setSuccess("");
        setSuccessTitle("");
      }, 5000);

      return () => window.clearTimeout(timer);
    }

    if (accessStatus === "denied") {
      setAccessNotice(
        "That account doesn't have access to the page you tried to open. Sign in with the correct account if needed.",
      );
      router.replace("/login", { scroll: false });
      const timer = window.setTimeout(() => {
        setAccessNotice("");
      }, 7000);

      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [searchParams, router]);

  useEffect(() => {
    if (!user) {
      return;
    }

    router.replace(getPostLoginRoute(user.role));
  }, [router, user]);

  const emailError = useMemo(() => {
    if (!error) return "";
    if (error.toLowerCase().includes("email")) {
      return error;
    }
    return "";
  }, [error]);

  const passwordError = useMemo(() => {
    if (!error) return "";
    if (error.toLowerCase().includes("password")) {
      return error;
    }
    return "";
  }, [error]);

  const submitLogin = useCallback(async (nextEmail, nextPassword) => {
    setError("");
    setSuccess("");
    setSuccessTitle("");
    setAccessNotice("");

    const sanitizedEmail = String(nextEmail || "").trim();
    const sanitizedPassword = String(nextPassword || "");

    setEmail(sanitizedEmail);
    setPassword(sanitizedPassword);

    if (!sanitizedEmail || !sanitizedPassword) {
      setError("Please enter both email and password.");
      return false;
    }

    setIsLoading(true);

    try {
      const response = await loginUser({ email: sanitizedEmail, password: sanitizedPassword });
      const userData = response.user || response.data?.user || response;
      const token = response.token || response.data?.token || response.accessToken;

      if (userData) {
        login(userData, token);
        router.replace(getPostLoginRoute(userData.role || userData.roleName));
        return true;
      }

      setError(
        safeErrorMessage(response.message, "") ||
          safeErrorMessage(response.error, "") ||
          "Login failed. Invalid response from server.",
      );
      return false;
    } catch (loginError) {
      console.error("Login error:", loginError);

      let errorMessage = "Invalid email or password.";
      const status = loginError?.status ?? loginError?.response?.status;
      const rawCandidate =
        loginError?.message ||
        loginError?.error ||
        loginError?.response?.data?.detail ||
        loginError?.response?.data?.message ||
        loginError?.response?.data?.error ||
        (typeof loginError === "string" ? loginError : "");
      const normalizedRawCandidate =
        typeof rawCandidate === "string" ? rawCandidate.trim().toLowerCase() : "";
      const looksLikeConnectivityFailure =
        normalizedRawCandidate.includes("network error") ||
        normalizedRawCandidate.includes("service unavailable") ||
        normalizedRawCandidate.includes("econnrefused") ||
        normalizedRawCandidate.includes("failed to fetch") ||
        normalizedRawCandidate.includes("connect") ||
        normalizedRawCandidate.includes("socket hang up");

      if (status === 404) {
        errorMessage =
          "Authentication service unavailable. Please check the backend server and API URL.";
      } else if (status === 500) {
        errorMessage = looksLikeConnectivityFailure
          ? "Authentication service unavailable. Please check the backend server and API URL."
          : "Server error. Please try again later.";
      } else if (status === 401) {
        errorMessage = "Invalid email or password.";
      } else if (!status && looksLikeConnectivityFailure) {
        errorMessage =
          "Authentication service unavailable. Please check the backend server and API URL.";
      } else {
        errorMessage = safeErrorMessage(rawCandidate, errorMessage);
      }

      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [login, router]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const nextEmail = String(formData.get("login-username") || email).trim();
    const nextPassword = String(formData.get("login-password") || password);

    await submitLogin(nextEmail, nextPassword);
  };

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
          <p className="login-hero__subtitle">Owner and Driver Access</p>
        </section>

        <section className="login-card" aria-label="Login form">
          <div className="login-card__inner">
            {success ? (
              <div className="login-state">
                <AlertIcon tone="success" />
                <h2 className="login-state__title">{successTitle || "Authentication successful"}</h2>
                <p className="login-state__text">
                  {success || "Redirecting to your dashboard..."}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="login-form" autoComplete="on">
                {accessNotice && (
                  <div className="login-alert" role="status">
                    <AlertIcon />
                    <div className="login-alert__copy">
                      <p className="login-alert__title">Sign in required</p>
                      <p className="login-alert__text">{accessNotice}</p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="login-alert" role="alert">
                    <AlertIcon />
                    <div className="login-alert__copy">
                      <p className="login-alert__title">Authentication issue</p>
                      <p className="login-alert__text">{error}</p>
                    </div>
                  </div>
                )}

                <div className="login-field">
                  <label htmlFor="login-email" className="login-field__label">
                    Email Address
                  </label>
                  <div className="login-field__control">
                    <LoginInputIcon type="mail" />
                    <input
                      type="email"
                      id="login-email"
                      name="login-username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="Enter your email"
                      className="login-input"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      inputMode="email"
                      spellCheck="false"
                      disabled={isLoading}
                      aria-invalid={Boolean(emailError)}
                      aria-describedby={emailError ? "email-error" : undefined}
                    />
                  </div>
                  {emailError && (
                    <p id="email-error" className="login-field__error">
                      {emailError}
                    </p>
                  )}
                </div>

                <div className="login-field">
                  <div className="login-field__header">
                    <label htmlFor="login-password" className="login-field__label">
                      Password
                    </label>
                    <span className="login-field__hint">Forgot?</span>
                  </div>
                  <div className="login-field__control login-field__control--password">
                    <LoginInputIcon type="lock" />
                    <input
                      type={showPassword ? "text" : "password"}
                      id="login-password"
                      name="login-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      className="login-input login-input--password"
                      autoComplete="current-password"
                      disabled={isLoading}
                      aria-invalid={Boolean(passwordError)}
                      aria-describedby={passwordError ? "password-error" : undefined}
                    />
                    <button
                      type="button"
                      className="login-password-toggle"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isLoading}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                    >
                      <PasswordVisibilityIcon visible={showPassword} />
                    </button>
                  </div>
                  {passwordError && (
                    <p id="password-error" className="login-field__error">
                      {passwordError}
                    </p>
                  )}
                </div>

                <button type="submit" className="login-button" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <LoadingIcon />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      Login
                      <ArrowIcon />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </section>

        {!success && (
          <section className="login-cta" aria-label="Signup link">
            {user ? (
              <p className="login-cta__text">
                Signed in as <strong>{user.name || user.email}</strong>.{" "}
                <button
                  type="button"
                  className="login-cta__link"
                  onClick={() => router.push("/admin/signout?next=/login")}
                >
                  Switch account
                </button>
              </p>
            ) : (
              <p className="login-cta__text">
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  className="login-cta__link"
                  onClick={() => router.push("/signup")}
                >
                  Create a new account
                </button>
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
