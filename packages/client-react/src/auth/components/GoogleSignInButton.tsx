import type { MouseEventHandler } from "react";
import { useState } from "react";

export interface GoogleSignInButtonProps {
  readonly onClick: () => Promise<void> | void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly className?: string;
  readonly label?: string;
}

/**
 * Google-branded sign-in button.  It defers token acquisition to the caller so that web and native
 * platforms can integrate with their respective Google Identity SDKs while reusing consistent UI.
 */
export const GoogleSignInButton = ({ onClick, disabled, loading, className, label = "Continue with Google" }: GoogleSignInButtonProps) => {
  const [pending, setPending] = useState(false);
  const isBusy = loading ?? pending;

  const handleClick: MouseEventHandler<HTMLButtonElement> = async (event) => {
    event.preventDefault();
    if (disabled || isBusy) {
      return;
    }
    try {
      setPending(true);
      await onClick();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      disabled={disabled || isBusy}
      aria-busy={isBusy}
      data-provider="google"
      style={{
        alignItems: "center",
        backgroundColor: "#fff",
        border: "1px solid #dadce0",
        borderRadius: "4px",
        color: "#1f1f1f",
        display: "inline-flex",
        fontSize: "14px",
        fontWeight: 500,
        gap: "0.75rem",
        padding: "0.5rem 1rem"
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center" }}>
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false">
          <path
            fill="#EA4335"
            d="M9 7.5v3h4.26c-.18 1.08-1.29 3.18-4.26 3.18-2.58 0-4.68-2.13-4.68-4.68s2.1-4.68 4.68-4.68c1.47 0 2.46.63 3.03 1.17l2.07-2.01C12.62 2.25 10.95 1.5 9 1.5 5.13 1.5 2 4.62 2 8.5s3.13 7 7 7c4.05 0 6.72-2.85 6.72-6.87 0-.45-.06-.78-.12-1.13H9z"
          />
        </svg>
      </span>
      <span>{isBusy ? "Waiting…" : label}</span>
    </button>
  );
};
