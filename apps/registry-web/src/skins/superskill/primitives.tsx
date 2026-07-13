import type { ButtonHTMLAttributes, ReactNode } from "react";

export function SSButton({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button {...props} className={`ss-button ss-button--${variant} ${className}`.trim()} />;
}

export function SectionHeading({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <div className="ss-section-heading">
      {eyebrow ? <div className="ss-eyebrow">{eyebrow}</div> : null}
      <h2>{children}</h2>
    </div>
  );
}

export function PageHeading({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <div className="ss-page-heading">
      {eyebrow ? <div className="ss-eyebrow">{eyebrow}</div> : null}
      <h1>{children}</h1>
    </div>
  );
}

export function ShellLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return <a className={`ss-link ${className}`.trim()} href={href}>{children}</a>;
}
