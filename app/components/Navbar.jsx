"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined"
import EventOutlinedIcon from "@mui/icons-material/EventOutlined"
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined"
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined"
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined"
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined"
import { useAuth } from "../context/AuthContext"
import "./Navbar.css"

const BRAND_ICON_SRC = "/icons/sm-racing-checkered-flag.svg"
const ASSISTANT_ICON_SRC = "/icons/sm-ai-assistant-icon.png"

const formatRoleLabel = (role) => {
  const normalized = String(role || "").toUpperCase()
  return normalized ? `${normalized.charAt(0)}${normalized.slice(1).toLowerCase()}` : ""
}

const getEventId = (event) => {
  if (typeof event === "string" || typeof event === "number") {
    const normalized = String(event).trim()
    return normalized || null
  }

  return event?.id || event?._id || event?.eventId || event?.event_id || null
}

const readStoredActiveEventId = () => {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const storedUser = window.localStorage.getItem("sm2_user")
    if (!storedUser) {
      return null
    }

    const parsedUser = JSON.parse(storedUser)
    return getEventId(parsedUser?.active_event_id || parsedUser?.activeEventId)
  } catch (error) {
    console.warn("Failed to read stored active event:", error)
    return null
  }
}

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isOwner, logout } = useAuth()
  const [activeEventId, setActiveEventId] = useState(null)

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/admin/signout" ||
    pathname === "/signup"
  const isSubmissionReportPage = pathname.startsWith("/admin/submissions/report/")

  const currentEventIdMatch = pathname.match(/^\/event\/([^/]+)/)
  const currentEventId = currentEventIdMatch?.[1] || null

  useEffect(() => {
    if (!user || isOwner()) {
      setActiveEventId(null)
      return
    }

    if (currentEventId) {
      setActiveEventId(currentEventId)
      return
    }

    const userActiveEventId =
      getEventId(user?.active_event_id) ||
      getEventId(user?.activeEventId) ||
      readStoredActiveEventId()

    setActiveEventId(userActiveEventId || null)
  }, [currentEventId, isOwner, user])

  if (isAuthPage || isSubmissionReportPage || !user) {
    return null
  }

  const handleLogout = async () => {
    if (isOwner()) {
      router.push("/admin/signout?next=/login")
      return
    }

    await logout()
    router.push("/login")
  }

  const handleDriverSubmissions = () => {
    const targetEventId = currentEventId || activeEventId

    if (targetEventId) {
      router.push(`/event/${targetEventId}/submissions`)
      return
    }

    router.push("/events")
  }

  const handleDashboard = () => {
    if (isOwner()) {
      router.push("/admin/users")
    } else {
      router.push("/events")
    }
  }

  const showChatbotLauncher = isOwner() && pathname.startsWith("/admin") && pathname !== "/admin/chatbot"

  const adminNavItems = [
    {
      href: "/admin/users",
      label: "Users",
      icon: AdminPanelSettingsOutlinedIcon,
      active: pathname === "/admin/users",
    },
    {
      href: "/admin/drivers",
      label: "Drivers",
      icon: PeopleAltOutlinedIcon,
      active: pathname === "/admin/drivers",
    },
    {
      href: "/admin/vehicles",
      label: "Vehicles",
      icon: DirectionsCarOutlinedIcon,
      active: pathname === "/admin/vehicles",
    },
    {
      href: "/admin/tracks",
      label: "Tracks",
      icon: RouteOutlinedIcon,
      active: pathname === "/admin/tracks",
    },
    {
      href: "/admin/events",
      label: "Events",
      icon: EventOutlinedIcon,
      active: pathname === "/admin/events",
    },
    {
      href: "/admin/submission-review-dashboard",
      label: "Session Review",
      icon: FactCheckOutlinedIcon,
      active:
        pathname === "/admin/submissions" ||
        pathname.startsWith("/admin/submissions/") ||
        pathname === "/admin/submission-review-dashboard",
    },
    {
      href: "/admin/chatbot",
      label: "AI Race Assistant",
      icon: null,
      assistant: true,
      active: pathname.startsWith("/admin/chatbot"),
    },
  ]

  return (
    <>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-brand" onClick={handleDashboard}>
            <span className="brand-icon" aria-hidden="true">
              <img
                src={BRAND_ICON_SRC}
                alt=""
                className="brand-icon-image"
                loading="eager"
                decoding="async"
              />
            </span>
            <span className="brand-text">
              <span className="brand-name">SM-2</span>
              <span className="brand-subtitle">RACE CONTROL</span>
            </span>
          </div>

          <div className="navbar-content">
            <div className="navbar-menu">
                {isOwner() ? (
                  adminNavItems.map((item) => {
                  const Icon = item.icon

                  return (
                    <button
                      key={item.href}
                      className={`nav-link ${item.active ? "active" : ""}`}
                      onClick={() => router.push(item.href)}
                      aria-current={item.active ? "page" : undefined}
                    >
                      <span
                        className={`nav-link-icon ${item.assistant ? "nav-link-icon-brand" : ""}`}
                        aria-hidden="true"
                      >
                        {item.assistant ? (
                          <img
                            src={ASSISTANT_ICON_SRC}
                            alt=""
                            className="nav-link-icon-image"
                            loading="eager"
                            decoding="async"
                          />
                        ) : (
                          <Icon fontSize="small" />
                        )}
                      </span>
                      <span className="nav-link-label">{item.label}</span>
                    </button>
                  )
                })
              ) : (
                <>
                  <button
                    className={`nav-link ${pathname === "/events" || pathname.startsWith("/event/") ? "active" : ""}`}
                    onClick={() => router.push("/events")}
                  >
                    <span className="nav-link-icon" aria-hidden="true">
                      <EventOutlinedIcon fontSize="small" />
                    </span>
                    <span className="nav-link-label">Events</span>
                  </button>
                  <button
                    className={`nav-link ${pathname.startsWith("/event/") && pathname.endsWith("/submissions") ? "active" : ""}`}
                    onClick={handleDriverSubmissions}
                    title={activeEventId ? "Open submissions for the active event" : "Select an event first to view submissions"}
                  >
                    <span className="nav-link-icon" aria-hidden="true">
                      <FactCheckOutlinedIcon fontSize="small" />
                    </span>
                    <span className="nav-link-label">Submissions</span>
                  </button>
                </>
              )}
            </div>

            <div className="navbar-user">
              <div className="user-info">
                <div className="user-name">{user.name || user.email}</div>
                <div className="user-role">{formatRoleLabel(user.role)}</div>
              </div>
              <button
                className="nav-link logout"
                onClick={handleLogout}
                title="Logout"
              >
                <span className="logout-icon" aria-hidden="true">
                  <LogoutOutlinedIcon fontSize="small" />
                </span>
                <span className="logout-text">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showChatbotLauncher ? (
        <button
          type="button"
          className="chatbot-launcher"
          onClick={() => router.push("/admin/chatbot")}
          aria-label="Open AI Race Assistant"
          title="Open AI Race Assistant"
        >
          <span className="chatbot-launcher-icon chatbot-launcher-icon-brand" aria-hidden="true">
            <img
              src={ASSISTANT_ICON_SRC}
              alt=""
              className="chatbot-launcher-icon-image assistant-icon-spin"
              loading="eager"
              decoding="async"
            />
          </span>
        </button>
      ) : null}
    </>
  )
}
