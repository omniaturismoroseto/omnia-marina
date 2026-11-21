"use client";

import { createContext, startTransition, use, useActionState, useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import type { FormState } from "@/lib/forms";

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: undefined, pending: false });

/**
 * Modulo collegato a un'azione server. I valori digitati restano al loro posto se il server
 * risponde con errori; con `resetOnSuccess` il modulo si svuota dopo un salvataggio riuscito.
 */
export function Form({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={className} noValidate>
      <FormContext value={{ state, pending }}>{children}</FormContext>
    </form>
  );
}

function useFieldError(name: string): string | undefined {
  return use(FormContext).state?.errors?.[name];
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-buoy-dark" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

type BaseProps = { name: string; label: string; hint?: ReactNode; wrapperClassName?: string };

export function Field({ name, label, hint, wrapperClassName, required, type, ...props }: BaseProps & Omit<ComponentProps<"input">, "name">) {
  const id = useId();
  const error = useFieldError(name);
  // Le password hanno accanto il pulsante per mostrarle o nasconderle.
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const input = (
    <input
      id={id}
      name={name}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      className={isPassword ? "input pr-11" : "input"}
      type={isPassword && shown ? "text" : type}
      {...props}
    />
  );
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      {isPassword ? (
        <div className="relative">
          {input}
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? "Nascondi la password" : "Mostra la password"}
            aria-pressed={shown}
            aria-controls={id}
            title={shown ? "Nascondi la password" : "Mostra la password"}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-sea/40 focus-visible:outline-none"
          >
            {shown ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
          </button>
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

export function TextareaField({ name, label, hint, wrapperClassName, required, ...props }: BaseProps & Omit<ComponentProps<"textarea">, "name">) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      <textarea id={id} name={name} required={required} aria-invalid={error ? true : undefined} className="input" {...props} />
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  hint,
  wrapperClassName,
  required,
  options,
  placeholder,
  ...props
}: BaseProps & Omit<ComponentProps<"select">, "name"> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      <select id={id} name={name} required={required} aria-invalid={error ? true : undefined} className="input" {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({ name, label, hint, ...props }: { name: string; label: ReactNode; hint?: ReactNode } & Omit<ComponentProps<"input">, "name" | "type">) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} name={name} type="checkbox" className="mt-0.5 size-[18px] shrink-0 rounded border-line accent-sea" {...props} />
      <div>
        <label htmlFor={id} className="text-[15px] text-ink">
          {label}
        </label>
        {hint && <p className="hint mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

export function Submit({
  children,
  variant = "primary",
  size,
  className = "",
  ...props
}: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "accent"; size?: "sm" | "lg" } & ComponentProps<"button">) {
  const { pending } = use(FormContext);
  return (
    <button type="submit" disabled={pending} className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`} {...props}>
      {pending ? "Attendere…" : children}
    </button>
  );
}

// Messaggio generale del modulo (errore o conferma).
export function FormMessage() {
  const { state } = use(FormContext);
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
      {state.message}
    </p>
  );
}

/**
 * Pulsante che esegue un'azione server con alcuni valori fissi (es. l'id di un contratto).
 * L'eventuale errore restituito dal server compare sotto il pulsante.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size,
  confirm,
  className = "",
}: {
  action: FormAction;
  fields?: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "lg";
  confirm?: string;
  className?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  return (
    <form
      action={dispatch}
      className="inline-flex flex-col items-stretch"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {fields && Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`}>
        {pending ? "Attendere…" : children}
      </button>
      {state?.message && !state.ok && (
        <span role="alert" className="field-error max-w-56">
          {state.message}
        </span>
      )}
    </form>
  );
}
