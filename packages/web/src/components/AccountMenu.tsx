import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "../maintainer/useAuth.js";

type Props = { user: AuthUser; onSignOut: () => void };

/**
 * GitHub-style account menu: the avatar is the button (a 44px target that fits a
 * phone's top bar), and signing out takes a second, deliberate tap.
 */
export function AccountMenu({ user, onSignOut }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    firstItemRef.current?.focus();
    const close = (returnFocus: boolean) => {
      setIsOpen(false);
      if (returnFocus) buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Account: ${user.login}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <img className="account-avatar" src={user.avatarUrl} alt="" width={28} height={28} />
      </button>
      {isOpen && (
        <div className="account-dropdown" role="menu" aria-label="Account">
          <p className="account-who">
            Signed in as <strong>{user.login}</strong>
          </p>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => {
              setIsOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
