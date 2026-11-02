"use client";

import { useEffect } from "react";

/** Also covers hybrid devices whose primary pointer is a mouse. */
export default function TouchEnvironment() {
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () => document.documentElement.classList.toggle("has-touch-input", media.matches || navigator.maxTouchPoints > 0);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return null;
}
