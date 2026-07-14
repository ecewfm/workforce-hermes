import { useEffect, useState } from "react";

/**
 * Full-screen intro animation that plays on:
 * 1. Successful login
 * 2. Opening the app when already authenticated (auto-login)
 *
 * The video fades out starting at 4s and is fully gone by ~5s.
 */
export default function IntroAnimation({ onDone }) {
  // "visible" controls the overlay opacity for the fade-out
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // Start fading at 4 seconds
    const fadeTimer = setTimeout(() => setFading(true), 4000);

    // Fully remove the overlay at 5 seconds
    const doneTimer = setTimeout(() => onDone(), 5000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000", // Black background prevents edge lines
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: "opacity 1s ease-in-out",
        pointerEvents: fading ? "none" : "all",
      }}
    >
      <video
        src="/logo%20animation.mp4"
        autoPlay
        muted
        playsInline
        style={{
          // Small, centered logo animation — sized like a loading indicator
          // rather than a full-screen cover.
          width: "min(320px, 60vw)",
          height: "auto",
          maxHeight: "60vh",
          objectFit: "contain",
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
        }}
      />
    </div>
  );
}
