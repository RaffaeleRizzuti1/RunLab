import { useEffect, useRef, useState, type ReactNode } from 'react';

const sections = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'comparison-lab', label: 'Comparison Lab' },
  { id: 'activities', label: 'Activities' },
] as const;

type SectionId = typeof sections[number]['id'];

function readSection() {
  return sections.find(({ id }) => window.location.hash === `#${id}`) ?? sections[0];
}

export function AppShell({ status, panels }: { status: ReactNode; panels: Record<SectionId, ReactNode> }) {
  const [section, setSection] = useState(readSection);
  const main = useRef<HTMLElement>(null);
  const previousSection = useRef(section.id);

  useEffect(() => {
    function syncSection() {
      setSection(readSection());
    }
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);

  useEffect(() => {
    if (previousSection.current !== section.id) {
      previousSection.current = section.id;
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
    }
  }, [section.id]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        main.current?.focus();
      }}>
        Skip to content
      </a>
      <aside className="app-sidebar">
        <a href="#dashboard" className="app-brand">Run<span>Lab</span></a>
        <nav aria-label="Main navigation" className="app-nav">
          {sections.map(({ id, label }) => (
            <a key={id} href={`#${id}`} aria-current={section.id === id ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="app-workspace">
        <header className="app-header">
          <div className="app-container app-header__content">
            <h1 id="app-page-title">{section.label}</h1>
            {status}
          </div>
        </header>
        <main className="app-container app-content" id="main-content" ref={main} tabIndex={-1}
          aria-labelledby="app-page-title">
          {sections.map(({ id }) => <div key={id} hidden={section.id !== id}>{panels[id]}</div>)}
        </main>
      </div>
    </div>
  );
}
