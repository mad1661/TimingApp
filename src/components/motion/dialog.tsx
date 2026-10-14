"use client";

// Adapted from Motion-Primitives `components/core/dialog.tsx` (MIT, see ./LICENSE):
// the same native <dialog> + showModal() approach (top layer, focus moved in,
// page behind inert, Escape closes) with the same variant/transition API.
// Changes: the dialog opens when it mounts and closes by unmounting, so the
// app's conditionally rendered modals keep their shape — wrap the condition in
// <AnimatePresence> to play the exit. The backdrop is an element inside the
// dialog so it can fade with it, a click only closes when it starts and ends
// outside the panel, the close icon is inline SVG (no lucide-react), and the
// default zoom is gentler (0.96 rather than 0.9).
import { motion, type Transition, type Variants } from "motion/react";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const DialogContext = createContext<{
  close: () => void;
  ids: { title: string; description: string };
} | null>(null);

function useDialogContext(component: string) {
  const context = useContext(DialogContext);
  if (!context) throw new Error(`${component} must be used within Dialog`);
  return context;
}

const defaultVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 4 },
};

const defaultTransition: Transition = {
  ease: "easeOut",
  duration: 0.18,
};

const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export type DialogProps = {
  onClose: () => void;
  children: ReactNode;
  /** Classes for the panel (width, padding). */
  className?: string;
  variants?: Variants;
  transition?: Transition;
};

function Dialog({ onClose, children, className, variants = defaultVariants, transition = defaultTransition }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const pressStartedOutside = useRef(false);
  const baseId = useId();
  const ids = {
    title: `motion-ui-dialog-title-${baseId}`,
    description: `motion-ui-dialog-description-${baseId}`,
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const close = () => onCloseRef.current();
    // Escape fires `cancel`; keep the dialog open so the exit can animate and
    // let the owner unmount it. `close` covers the browser closing it anyway.
    const handleCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", close);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", close);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <DialogContext.Provider value={{ close: () => onCloseRef.current(), ids }}>
      <motion.dialog
        ref={dialogRef}
        aria-labelledby={ids.title}
        aria-describedby={ids.description}
        initial="initial"
        animate="animate"
        exit="exit"
        className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-transparent p-0 text-inherit backdrop:bg-transparent"
      >
        <motion.div
          aria-hidden="true"
          variants={backdropVariants}
          transition={transition}
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] light:bg-zinc-900/30"
        />
        <div
          className="relative flex min-h-full items-center justify-center p-4"
          onMouseDown={(e) => {
            pressStartedOutside.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (pressStartedOutside.current && e.target === e.currentTarget) onCloseRef.current();
          }}
        >
          <motion.div
            variants={variants}
            transition={transition}
            className={cn(
              "relative w-full rounded-xl border border-nhra-border bg-nhra-dark p-6 shadow-[var(--ui-shadow-overlay)]",
              className,
            )}
          >
            {children}
          </motion.div>
        </div>
      </motion.dialog>
    </DialogContext.Provider>
  );
}

export type DialogHeaderProps = {
  children: ReactNode;
  className?: string;
};

function DialogHeader({ children, className }: DialogHeaderProps) {
  return <div className={cn("mb-5 flex items-start justify-between gap-4", className)}>{children}</div>;
}

export type DialogTitleProps = {
  children: ReactNode;
  className?: string;
};

function DialogTitle({ children, className }: DialogTitleProps) {
  const { ids } = useDialogContext("DialogTitle");
  return (
    <h2 id={ids.title} className={cn("text-lg font-semibold tracking-tight text-white", className)}>
      {children}
    </h2>
  );
}

export type DialogDescriptionProps = {
  children: ReactNode;
  className?: string;
};

function DialogDescription({ children, className }: DialogDescriptionProps) {
  const { ids } = useDialogContext("DialogDescription");
  return (
    <p id={ids.description} className={cn("mt-1 text-xs text-gray-500", className)}>
      {children}
    </p>
  );
}

export type DialogCloseProps = {
  className?: string;
  disabled?: boolean;
};

function DialogClose({ className, disabled }: DialogCloseProps) {
  const { close } = useDialogContext("DialogClose");
  return (
    <button
      type="button"
      onClick={close}
      disabled={disabled}
      aria-label="Close dialog"
      className={cn("btn btn-ghost -mr-2 -mt-1 h-8 w-8 shrink-0 p-0", className)}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogClose };
