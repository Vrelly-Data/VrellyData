import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function RouteChangeTracker() {
  const location = useLocation();

  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      const pagePath = `${location.pathname}${location.search || ""}`;
      window.gtag("event", "page_view", {
        page_path: pagePath,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
  }, [location.pathname, location.search]);

  return null;
}

