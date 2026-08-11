"use client";

import { useId, useRef, useState } from "react";

// Password input with a show/hide (eye) toggle, and — when `confirm` is set — a
// second "confirm" field that must match. Match is enforced with native form
// validity (setCustomValidity), so it blocks submission on both native POST
// forms and server-action forms without extra JS. Used everywhere a password is
// set (register, setup, reset, staff create). Login uses it without `confirm`.

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      {off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.9 2.4-2.4 3.7M6.1 6.1C4 7.4 3 9.2 3 12c0 0 1.6 3.2 5 4.4" />
        </>
      ) : (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      )}
    </svg>
  );
}

export function PasswordField({
  name,
  label,
  confirm = false,
  confirmLabel = "Confirm password",
  minLength = 8,
  required = true,
  autoComplete = "new-password",
  hint,
}: {
  name: string;
  label: string;
  confirm?: boolean;
  confirmLabel?: string;
  minLength?: number;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Keep the confirm field's native validity in sync so the browser blocks
  // submit — and reflect it inline for a clear message.
  function sync() {
    if (!confirm || !confirmRef.current) return;
    const a = pwRef.current?.value ?? "";
    const b = confirmRef.current.value;
    // Block submit whenever they differ (covers "password typed, confirm empty",
    // which matters for optional passwords). Only show the inline message once
    // the user has started typing the confirmation, so it isn't premature.
    confirmRef.current.setCustomValidity(a !== b ? "Passwords don't match." : "");
    setMismatch(b.length > 0 && a !== b);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor={`${id}-pw`}>{label}</label>
        <div className="relative">
          <input
            ref={pwRef}
            id={`${id}-pw`}
            name={name}
            type={show ? "text" : "password"}
            minLength={minLength}
            required={required}
            autoComplete={autoComplete}
            onChange={sync}
            className="input pr-11"
          />
          <ToggleButton shown={show} onClick={() => setShow((s) => !s)} />
        </div>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>

      {confirm && (
        <div>
          <label className="label" htmlFor={`${id}-confirm`}>{confirmLabel}</label>
          <div className="relative">
            <input
              ref={confirmRef}
              id={`${id}-confirm`}
              name={`${name}Confirm`}
              type={showConfirm ? "text" : "password"}
              minLength={minLength}
              required={required}
              autoComplete={autoComplete}
              onChange={sync}
              aria-invalid={mismatch}
              className={`input pr-11 ${mismatch ? "ring-1 ring-rose-300" : ""}`}
            />
            <ToggleButton shown={showConfirm} onClick={() => setShowConfirm((s) => !s)} />
          </div>
          {mismatch && <p className="mt-1 text-xs text-rose-600">Passwords don&apos;t match.</p>}
        </div>
      )}
    </div>
  );
}

function ToggleButton({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      aria-label={shown ? "Hide password" : "Show password"}
      title={shown ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-600"
    >
      <EyeIcon off={shown} />
    </button>
  );
}
