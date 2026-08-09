import { useEffect, useRef, useState, useCallback } from "react";
import { updateActivityApi, logSessionAuditEventApi } from "../services/api";

const BROADCAST_CHANNEL_NAME = "boon_huat_session_sync";
const ACTIVITY_PING_THROTTLE_MS = 30000; // Throttle server activity updates to once per 30 seconds

interface UseInactivityManagerOptions {
  isAuthenticated: boolean;
  inactivityTimeoutMinutes: number;
  hasUnsavedChanges?: boolean;
  onLogout: (reason: "INACTIVITY_TIMEOUT" | "MANUAL") => void;
  onTimeoutSettingUpdated?: (newMinutes: number) => void;
}

export function useInactivityManager({
  isAuthenticated,
  inactivityTimeoutMinutes,
  hasUnsavedChanges = false,
  onLogout,
  onTimeoutSettingUpdated
}: UseInactivityManagerOptions) {
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);

  const lastActivityTime = useRef<number>(Date.now());
  const lastServerPingTime = useRef<number>(0);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const warningLoggedRef = useRef<boolean>(false);

  // Initialize BroadcastChannel for cross-tab synchronization
  useEffect(() => {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannelRef.current = channel;

      channel.onmessage = (event) => {
        const data = event.data;
        if (!data || !data.type) return;

        if (data.type === "LOGOUT") {
          onLogout(data.reason || "INACTIVITY_TIMEOUT");
        } else if (data.type === "TIMEOUT_SETTING_CHANGED") {
          if (onTimeoutSettingUpdated && typeof data.minutes === "number") {
            onTimeoutSettingUpdated(data.minutes);
          }
        } else if (data.type === "ACTIVITY_PING") {
          if (typeof data.timestamp === "number" && !showWarningModal) {
            lastActivityTime.current = data.timestamp;
          }
        }
      };

      return () => {
        channel.close();
      };
    }
  }, [onLogout, onTimeoutSettingUpdated, showWarningModal]);

  // Helper to broadcast events to other tabs
  const broadcast = useCallback((message: any) => {
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage(message);
      } catch (err) {
        console.warn("BroadcastChannel error:", err);
      }
    }
  }, []);

  // Handle genuine user activity (clicks, keypresses, touches, scrolls)
  const handleUserActivity = useCallback(() => {
    if (!isAuthenticated) return;

    // Rule 9: If warning modal is open, ignore passive mouse/keyboard events.
    // User must click "Stay Signed In" to dismiss warning modal.
    if (showWarningModal) return;

    const now = Date.now();
    lastActivityTime.current = now;

    // Send throttled server activity update
    if (now - lastServerPingTime.current >= ACTIVITY_PING_THROTTLE_MS) {
      lastServerPingTime.current = now;
      updateActivityApi().catch((err) => {
        if (err?.message === "SESSION_EXPIRED") {
          onLogout("INACTIVITY_TIMEOUT");
        }
      });
      broadcast({ type: "ACTIVITY_PING", timestamp: now });
    }
  }, [isAuthenticated, showWarningModal, onLogout, broadcast]);

  // Listen for user interaction events
  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const throttledHandler = () => handleUserActivity();

    events.forEach((evt) => {
      window.addEventListener(evt, throttledHandler, { passive: true });
    });

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, throttledHandler);
      });
    };
  }, [isAuthenticated, handleUserActivity]);

  // Inactivity check loop running every 1 second
  useEffect(() => {
    if (!isAuthenticated) {
      setShowWarningModal(false);
      warningLoggedRef.current = false;
      return;
    }

    const intervalId = setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - lastActivityTime.current;
      const timeoutMs = inactivityTimeoutMinutes * 60 * 1000;

      // 1-minute timeout behavior: 15s warning threshold; else 60s warning threshold
      const warningDurationMs = inactivityTimeoutMinutes === 1 ? 15000 : 60000;
      const warningThresholdMs = Math.max(0, timeoutMs - warningDurationMs);

      if (elapsedMs >= timeoutMs) {
        // Inactivity timeout expired!
        setShowWarningModal(false);
        warningLoggedRef.current = false;
        broadcast({ type: "LOGOUT", reason: "INACTIVITY_TIMEOUT" });
        onLogout("INACTIVITY_TIMEOUT");
      } else if (elapsedMs >= warningThresholdMs) {
        // Enter warning state
        const remaining = Math.max(0, Math.ceil((timeoutMs - elapsedMs) / 1000));
        setSecondsRemaining(remaining);

        if (!warningLoggedRef.current) {
          warningLoggedRef.current = true;
          setShowWarningModal(true);
          logSessionAuditEventApi({
            actionType: "SESSION_TIMEOUT_WARNING_DISPLAYED",
            result: "INFO",
            reason: `Session timeout warning displayed (${remaining} seconds remaining)`
          });
        }
      } else {
        // Normal active state
        if (showWarningModal) {
          setShowWarningModal(false);
        }
        warningLoggedRef.current = false;
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isAuthenticated, inactivityTimeoutMinutes, showWarningModal, onLogout, broadcast]);

  // "Stay Signed In" button handler
  const handleStaySignedIn = async () => {
    try {
      const res = await updateActivityApi();
      if (res && res.success) {
        const now = Date.now();
        lastActivityTime.current = now;
        lastServerPingTime.current = now;
        setShowWarningModal(false);
        warningLoggedRef.current = false;

        logSessionAuditEventApi({
          actionType: "SESSION_EXTENDED_BY_USER",
          result: "SUCCESS",
          reason: "User clicked Stay Signed In to extend session"
        });

        broadcast({ type: "ACTIVITY_PING", timestamp: now });
      } else {
        onLogout("INACTIVITY_TIMEOUT");
      }
    } catch (err) {
      onLogout("INACTIVITY_TIMEOUT");
    }
  };

  // "Sign Out Now" button handler
  const handleSignOutNow = () => {
    setShowWarningModal(false);
    broadcast({ type: "LOGOUT", reason: "INACTIVITY_TIMEOUT" });
    onLogout("INACTIVITY_TIMEOUT");
  };

  // Helper to notify other tabs when setting is changed
  const notifyTimeoutSettingChanged = (newMinutes: number) => {
    broadcast({ type: "TIMEOUT_SETTING_CHANGED", minutes: newMinutes });
  };

  // Helper to notify other tabs when user manually logs out
  const notifyManualLogout = () => {
    broadcast({ type: "LOGOUT", reason: "MANUAL" });
  };

  return {
    showWarningModal,
    secondsRemaining,
    handleStaySignedIn,
    handleSignOutNow,
    notifyTimeoutSettingChanged,
    notifyManualLogout
  };
}
