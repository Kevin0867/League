"use client";

import { useEffect, useRef, useState } from "react";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** A branded confirmation modal (replaces window.confirm) — accessible, Escape to cancel. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">{cancelLabel}</button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A native form-POST button that (a) confirms via a branded modal before acting
 * and (b) shows a pending spinner and disables itself once submitting, so a
 * money/email action can never be double-fired. Same API as before.
 */
export function ConfirmSubmit({
  action,
  fields,
  confirm,
  confirmTitle = "Please confirm",
  label,
  className = "btn-primary",
  disabled,
  danger,
}: {
  action: string;
  fields: Record<string, string>;
  confirm: string;
  confirmTitle?: string;
  label: string;
  className?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <>
      <form ref={formRef} method="POST" action={action}>
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button
          type="button"
          className={`${className} inline-flex items-center justify-center gap-2`}
          disabled={disabled || pending}
          aria-busy={pending}
          onClick={() => setAsking(true)}
        >
          {pending ? <Spinner /> : null}
          {label}
        </button>
      </form>
      <ConfirmModal
        open={asking}
        title={confirmTitle}
        message={confirm}
        danger={danger}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          setPending(true);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}

/**
 * A plain submit button for forms with user inputs: on submit it disables and
 * shows a spinner so the form can't be double-submitted while the POST + redirect
 * completes. Native `required` validation still runs first (the submit event only
 * fires when the form is valid), so it never gets stuck on a blocked submit.
 */
export function PendingSubmit({
  label,
  className = "btn-primary",
  pendingLabel,
}: {
  label: string;
  className?: string;
  pendingLabel?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = () => setPending(true);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  return (
    <button ref={ref} type="submit" className={`${className} inline-flex items-center justify-center gap-2`} disabled={pending} aria-busy={pending}>
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel ?? label : label}
    </button>
  );
}
