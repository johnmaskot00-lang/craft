import { Switch, Route, Redirect, useLocation } from "wouter";
import { useEffect, lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import AuthPage from "@/pages/auth-page";
import CookieConsent from "@/components/cookie-consent";
import { Loader2 } from "lucide-react";
import { captureReferralFromUrl, storeReferralCode } from "@/lib/referral";

const DashboardPage = lazy(() => import("@/pages/dashboard"));
const EditorPage = lazy(() => import("@/pages/editor"));
const SeoEditorPage = lazy(() => import("@/pages/seo-editor"));
const LeadsPage = lazy(() => import("@/pages/leads"));
const GenerationsPage = lazy(() => import("@/pages/generations"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const LegalPage = lazy(() => import("@/pages/legal"));
const AdminPage = lazy(() => import("@/pages/admin"));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  return null;
}

function ReferralLanding({ params }: { params: { code?: string } }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const code = storeReferralCode(params.code);
    if (code) {
      void fetch(`/api/referral/capture?ref=${encodeURIComponent(code)}`, { credentials: "include" }).catch(() => {});
    }
    setLocation(code ? `/auth?ref=${encodeURIComponent(code)}` : "/auth");
  }, [params.code, setLocation]);
  return <RouteFallback />;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
}

function AuthRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (user) {
    return <Redirect to="/dashboard" />;
  }

  return <AuthPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/r/:code" component={ReferralLanding} />
      <Route path="/" component={LandingPage} />
      <Route path="/auth" component={AuthRoute} />
      <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} />}</Route>
      <Route path="/leads">{() => <ProtectedRoute component={LeadsPage} />}</Route>
      <Route path="/generations">{() => <ProtectedRoute component={GenerationsPage} />}</Route>
      <Route path="/profile">{() => <ProtectedRoute component={ProfilePage} />}</Route>
      <Route path="/editor/:id">{() => <ProtectedRoute component={EditorPage} />}</Route>
      <Route path="/seo/:id">{() => <ProtectedRoute component={SeoEditorPage} />}</Route>
      <Route path="/admin">{() => <ProtectedRoute component={AdminPage} />}</Route>
      <Route path="/oferta">{() => (
        <Suspense fallback={<RouteFallback />}>
          <LegalPage doc="oferta" />
        </Suspense>
      )}</Route>
      <Route path="/privacy">{() => (
        <Suspense fallback={<RouteFallback />}>
          <LegalPage doc="privacy" />
        </Suspense>
      )}</Route>
      <Route path="/terms">{() => (
        <Suspense fallback={<RouteFallback />}>
          <LegalPage doc="terms" />
        </Suspense>
      )}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ReferralCapture />
          <Toaster />
          <CookieConsent />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
