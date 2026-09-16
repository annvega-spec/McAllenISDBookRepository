import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="site-header no-print">
      <div className="brand">
        <Logo className="brand-logo" />
        <div className="brand-text">
          <p className="brand-kicker">McAllen Independent School District</p>
          <h1>McAllen ISD Collection Check</h1>
          <p className="brand-sub">Library acquisitions · Community review desk</p>
        </div>
      </div>
      <p className="header-aside">
        HAVE IT lookup for campus librarians: posted, owned, and eBook orders
      </p>
    </header>
  );
}
