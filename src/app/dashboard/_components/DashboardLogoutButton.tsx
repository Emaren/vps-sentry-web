"use client";

import React from "react";
import { signOut } from "next-auth/react";

export default function DashboardLogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="app-header-btn"
      aria-label="Log out"
    >
      Logout
    </button>
  );
}
