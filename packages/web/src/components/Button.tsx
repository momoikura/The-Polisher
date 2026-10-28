import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  isLoading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  loadingLabel,
  icon,
  trailingIcon,
  children,
  disabled,
  className = "",
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? <span className="spinner" aria-hidden="true" /> : icon}
      <span>{isLoading && loadingLabel ? loadingLabel : children}</span>
      {!isLoading && trailingIcon && <span className="btn-trailing">{trailingIcon}</span>}
    </button>
  );
}
