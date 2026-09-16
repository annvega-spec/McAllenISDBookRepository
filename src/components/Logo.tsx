import type { SVGProps } from "react";

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="1.5" y="1.5" width="61" height="61" rx="12" className="logo-plate" />
      <path
        d="M16 47.5V16.8c7.1 3.6 11.6 3.8 16 0 4.4 3.8 8.9 3.6 16 0V47.5c-7.1 3.6-11.6 3.8-16 0-4.4 3.8-8.9 3.6-16 0z"
        className="logo-book"
      />
      <path d="M32 19.2v26.2" className="logo-spine" />
    </svg>
  );
}
