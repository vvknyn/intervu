"use client";

import { useContext } from "react";
import { TourContext } from "@/components/tour/TourProvider";

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return ctx;
}
