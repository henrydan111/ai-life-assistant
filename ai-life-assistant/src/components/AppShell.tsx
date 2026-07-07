"use client";

export function AppShell({ children, displayMode = false }: { children: React.ReactNode; displayMode?: boolean }) {
  return (
    <div className={displayMode ? "app-shell display-mode" : "app-shell"}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main id="main-content" className="main-wrap" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
