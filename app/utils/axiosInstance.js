import axios from "axios";

// Always prefer the same-origin /api/v1 proxy in production.
// That keeps browser requests on the Vercel origin and avoids CORS failures
// against the Render backend. Local development also uses the same proxy path.
const apiBaseURL =
  process.env.NODE_ENV === "production"
    ? "/api/v1"
    : (process.env.NEXT_PUBLIC_API_URL || "/api/v1").trim();

const axiosInstance = axios.create({
  baseURL: apiBaseURL,

  headers: {
    "Content-Type": "application/json",
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    "Cache-Control": "no-cache, no-store, must-revalidate", // Prevent 304 responses
    Pragma: "no-cache",
    Expires: "0",
  },
});

// Request interceptor - Add auth token to every request
axiosInstance.interceptors.request.use(
  (config) => {
    // Get token from localStorage
    const token = localStorage.getItem("sm2_token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor - Handle errors globally
axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle 401 Unauthorized - token expired or invalid
    if (error.response?.status === 401) {
      // Clear token and user data
      localStorage.removeItem("sm2_token");
      localStorage.removeItem("sm2_user");

      // Redirect to login if not already on an auth screen that needs to handle 401s itself.
      if (
        typeof window !== "undefined" &&
        ![
          "/login",
          "/admin/signout",
          "/signup",
        ].includes(window.location.pathname)
      ) {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

export default axiosInstance;
