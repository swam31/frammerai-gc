"use client";

import React from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, LockKeyhole, Sparkles, User2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

const auraItems = [
  {
    size: 440,
    top: "-6%",
    left: "-8%",
    delay: 0,
    duration: 16,
    color: "rgba(255, 87, 34, 0.26)",
  },
  {
    size: 360,
    top: "54%",
    left: "64%",
    delay: 1.2,
    duration: 18,
    color: "rgba(255, 16, 110, 0.22)",
  },
  {
    size: 240,
    top: "16%",
    left: "72%",
    delay: 0.4,
    duration: 12,
    color: "rgba(255, 203, 112, 0.18)",
  },
  {
    size: 320,
    top: "72%",
    left: "18%",
    delay: 1.8,
    duration: 14,
    color: "rgba(255, 61, 127, 0.18)",
  },
];

const statItems = [
  { label: "Primary Views", value: "Executive, Quality, Usage" },
  { label: "Ops Layer", value: "Control Tower + Explorer" },
  { label: "Focus", value: "KPIs, video flow, NLP" },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = login(username.trim(), password);

    if (!result.ok) {
      setError(result.error ?? "Login failed.");
      return;
    }

    setError("");
    setPassword("");
  };

  return (
    <div className="login-shell">
      <div className="login-grid" />
      <div className="login-noise" />
      <motion.div
        className="login-sunbeam"
        animate={{ rotate: 360 }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      />

      {auraItems.map((item, index) => (
        <motion.div
          key={`${item.top}-${item.left}-${index}`}
          className="login-aura"
          style={{
            width: item.size,
            height: item.size,
            top: item.top,
            left: item.left,
            background: item.color,
          }}
          animate={{
            x: [0, 40, -24, 0],
            y: [0, -36, 28, 0],
            scale: [1, 1.08, 0.94, 1],
          }}
          transition={{
            duration: item.duration,
            delay: item.delay,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
          }}
        />
      ))}

      <div className="login-content">
        <motion.section
          className="login-hero"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="login-kicker"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
          >
            <Sparkles size={16} />
            Frammer analytics
          </motion.div>

          <motion.h1
            className="login-title"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
          >
            Command center for pipeline, content, and performance analytics.
          </motion.h1>

          <motion.p
            className="login-copy"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.26 }}
          >
            Sign in to reach the executive summary, control tower, video
            explorer, quality checks, custom KPI views, and the rest of the
            Frammer dashboard stack from one surface.
          </motion.p>

          <motion.div
            className="login-stat-row"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.34 }}
          >
            {statItems.map((item) => (
              <div key={item.label} className="login-stat-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          className="login-panel"
          initial={{ opacity: 0, scale: 0.96, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="login-panel__chrome">
            <span />
            <span />
            <span />
          </div>

          <div className="login-panel__head">
            <div>
              <p className="login-panel__eyebrow">
                Frammer Analytics Authentication
              </p>
              <h2>Admin Login</h2>
            </div>
            {/* <button type="button" className="login-theme-toggle" onClick={toggleTheme}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button> */}
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-field">
              <span>Username</span>
              <div className="login-input-shell">
                <User2 size={17} />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="login-field">
              <span>Password</span>
              <div className="login-input-shell">
                <LockKeyhole size={17} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="login-visibility"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="login-submit">
              Unlock dashboard
            </button>

            <div className={`login-status ${error ? "is-error" : "is-ready"}`}>
              {error || "Welcome to Frammer Analytics!"}
            </div>
          </form>
        </motion.section>
      </div>
    </div>
  );
}
