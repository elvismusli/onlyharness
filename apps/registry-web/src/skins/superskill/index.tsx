import { useEffect } from "react";

import { useSuperSkillRoute } from "../../core/superskill-route";
import { StatePanel } from "./components/StatePanel";
import { SuperSkillHeader } from "./components/SuperSkillHeader";
import { ShellLink } from "./primitives";
import { AgentGuidePage } from "./pages/AgentGuidePage";
import { AccountPage } from "./pages/AccountPage";
import { CategoryPage } from "./pages/CategoryPage";
import { DocsPage } from "./pages/DocsPage";
import { InstallHandoff } from "./pages/InstallHandoff";
import { Landing } from "./pages/Landing";
import { PublishPage } from "./pages/PublishPage";
import { ResourcePage } from "./pages/ResourcePage";
import { SelectedSkillPage } from "./pages/SelectedSkillPage";
import { TrustPage } from "./pages/TrustPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { useReveal } from "./useReveal";
import "./tokens.css";
import "./motion.css";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,500&family=Schibsted+Grotesk:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500&display=swap";

export function SuperskillSkin() {
  const route = useSuperSkillRoute();
  useSuperskillEnvironment();
  useReveal();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [route]);
  return (
    <div className="skin-superskill" data-skin="superskill">
      <SuperSkillHeader route={route} />
      {renderRoute(route)}
      <footer className="ss-footer"><div className="ss-content"><strong>SuperSkill</strong><span>Evidence over badges · exact release trust · explicit consent</span></div></footer>
    </div>
  );
}

function renderRoute(route: ReturnType<typeof useSuperSkillRoute>) {
  switch (route.name) {
    case "landing": return <Landing />;
    case "docs": return <DocsPage />;
    case "agent-guide": return <AgentGuidePage />;
    case "account": return <AccountPage />;
    case "publish": return <PublishPage />;
    case "workspaces": return <WorkspacesPage />;
    case "resource": return <ResourcePage resourceId={route.resourceId} />;
    case "capability": return <TrustPage capabilityId={route.capabilityId} />;
    case "selected": return <SelectedSkillPage owner={route.owner} skill={route.skill} />;
    case "install": return <main className="ss-content ss-page"><InstallHandoff capabilityId={route.capabilityId} /></main>;
    case "category": return <CategoryPage job={route.job} />;
    case "not-found": return <main className="ss-content ss-page"><StatePanel headingLevel={1} kind="not-found" title="Page not found" reason="This SuperSkill hash route is not recognized." next="Return to the showroom." ><ShellLink href="#/superskill">Open showroom</ShellLink></StatePanel></main>;
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
    body.style.background = "#f6f4ef";
    documentElement.style.background = "#f6f4ef";
    return () => {
      body.style.background = previous.body;
      documentElement.style.background = previous.html;
    };
  }, []);
}
