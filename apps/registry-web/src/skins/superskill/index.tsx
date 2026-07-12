import { useEffect } from "react";

import { useSuperSkillRoute } from "../../core/superskill-route";
import { StatePanel } from "./components/StatePanel";
import { ShellLink } from "./primitives";
import { CategoryPage } from "./pages/CategoryPage";
import { InstallHandoff } from "./pages/InstallHandoff";
import { Landing } from "./pages/Landing";
import { TrustPage } from "./pages/TrustPage";
import "./tokens.css";
import "./motion.css";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&family=Spectral:ital,wght@0,400;0,500;1,400;1,500&display=swap";

export function SuperskillSkin() {
  const route = useSuperSkillRoute();
  useSuperskillEnvironment();
  return (
    <div className="skin-superskill" data-skin="superskill">
      <header className="ss-nav"><div className="ss-nav-inner"><ShellLink className="ss-brand" href="#/superskill"><span aria-hidden>S</span><strong>SuperSkill</strong></ShellLink><nav aria-label="SuperSkill"><a href="#/superskill">Showroom</a><a href="/llms.txt">Docs</a><a href="/AGENTS.md">Agent guide</a></nav><ShellLink className="ss-link--primary" href="#/superskill">Get SuperSkill</ShellLink></div></header>
      {renderRoute(route)}
      <footer className="ss-footer"><div className="ss-content"><strong>SuperSkill by OnlyHarness</strong><span>Evidence over badges · exact release trust · explicit consent</span></div></footer>
    </div>
  );
}

function renderRoute(route: ReturnType<typeof useSuperSkillRoute>) {
  switch (route.name) {
    case "landing": return <Landing />;
    case "capability": return <TrustPage capabilityId={route.capabilityId} />;
    case "install": return <main className="ss-content ss-page"><InstallHandoff capabilityId={route.capabilityId} /></main>;
    case "category": return <CategoryPage job={route.job} />;
    case "not-found": return <main className="ss-content ss-page"><StatePanel kind="not-found" title="Page not found" reason="This SuperSkill hash route is not recognized." next="Return to the showroom." ><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
  }
}

function useSuperskillEnvironment() {
  useEffect(() => {
    if (!document.getElementById("oh-superskill-fonts")) {
      const link = document.createElement("link");
      link.id = "oh-superskill-fonts";
      link.rel = "stylesheet";
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    const { body, documentElement } = document;
    const previous = { body: body.style.background, html: documentElement.style.background };
    body.style.background = "#f7f6f1";
    documentElement.style.background = "#f7f6f1";
    return () => {
      body.style.background = previous.body;
      documentElement.style.background = previous.html;
    };
  }, []);
}
