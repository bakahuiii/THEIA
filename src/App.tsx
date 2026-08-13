import { isDesktop } from "./bridge";
import theiaMark from "./assets/theia-mark.png";
import { useTheiaApp } from "./hooks/useTheiaApp";
import { useAppearance } from "./hooks/useAppearance";
import { usePersonalization } from "./hooks/usePersonalization";
import { TitleBar } from "./layout/TitleBar";
import { AppSidebar } from "./layout/AppSidebar";
import { WorkspaceChrome } from "./layout/WorkspaceChrome";
import { viewTitles } from "./ui/navigation";
import { DashboardView } from "./views/DashboardView";
import { ScheduleView } from "./views/ScheduleView";
import { CampusMapView } from "./views/CampusMapView";
import { ExamsView } from "./views/ExamsView";
import { GradesView } from "./views/GradesView";
import { AcademicProgressView } from "./views/AcademicProgressView";
import { CoursesView } from "./views/CoursesView";
import { CourseSelectionView } from "./views/CourseSelectionView";
import { AssignmentsView } from "./views/AssignmentsView";
import { SettingsView } from "./views/SettingsView";
import { ToolsView } from "./views/ToolsView";
import { CommunicationsView } from "./views/CommunicationsView";
import { CredentialSetupModal } from "./views/settings/Credentials";
import { GradientMapFilter } from "./components/GradientMapFilter";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";

export default function App() {
  const app = useTheiaApp();
  useAppearance(); // apply stored dark/light mode on mount
  const personalization = usePersonalization();
  const gradientMapActive =
    personalization.preferences.background === "image" &&
    personalization.preferences.gradientMap.enabled;
  if (!app.state)
    return (
      <TooltipProvider>
      <GradientMapFilter
        active={gradientMapActive}
        colors={personalization.preferences.gradientMap}
      />
      <main className="loading-screen">
        <div className="brand-mark">
          <img src={theiaMark} alt="THEIA" />
        </div>
        <strong className="loading-wordmark">THEIA</strong>
        <span
          role={app.startupError ? "alert" : "status"}
          aria-live={app.startupError ? "assertive" : "polite"}
        >
          {app.startupError || app.syncProgress || "正在读取本地校园数据"}
        </span>
      </main>
      </TooltipProvider>
    );

  const state = app.state;
  const goTo = (view: typeof app.view) => {
    app.setView(view);
    app.setSidebarOpen(false);
  };
  const goToFromPalette = (view: typeof app.view) => {
    goTo(view);
    app.setPaletteOpen(false);
    app.setPaletteQuery("");
  };
  const allSourcesConnected =
    app.auth.jwglxt.connected && app.auth.theol.connected;

  return (
    <TooltipProvider>
    <GradientMapFilter
      active={gradientMapActive}
      colors={personalization.preferences.gradientMap}
    />
    <div
      className={`app-shell view-${app.view}${app.sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}
    >
      <TitleBar />
      <div className="app-body">
      <AppSidebar
        state={state}
        syncing={app.syncing}
        syncFreshness={app.syncFreshness}
        view={app.view}
        settingsOpen={app.settingsOpen}
        open={app.sidebarOpen}
        collapsed={app.sidebarCollapsed}
        mark={theiaMark}
        onNavigate={goTo}
        onClose={() => app.setSidebarOpen(false)}
        onToggleCollapsed={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
        onOpenSettings={() => app.setSettingsOpen(true)}
      />
      <WorkspaceChrome
        state={state}
        view={app.view}
        title={viewTitles[app.view]}
        auth={app.auth}
        syncing={app.syncing}
        syncPercent={app.syncPercent}
        syncProgress={app.syncProgress}
        hasSession={app.hasSession}
        allSourcesConnected={allSourcesConnected}
        credentialsSaved={app.credentials.saved}
        query={app.query}
        message={app.message}
        messageKind={app.messageKind}
        syncFailure={app.syncFailure}
        syncFreshness={app.syncFreshness}
        paletteOpen={app.paletteOpen}
        paletteQuery={app.paletteQuery}
        paletteItems={app.paletteItems}
        onOpenSidebar={() => app.setSidebarOpen(true)}
        onOpenAppearanceSettings={() => app.setSettingsOpen(true)}
        onQueryChange={app.setQuery}
        onSync={() => void app.sync()}
        onRequestLogin={() => void app.requestLogin()}
        onDismissMessage={() => app.setMessage(null)}
        onDismissSyncFailure={app.dismissSyncFailure}
        onPaletteQueryChange={app.setPaletteQuery}
        onClosePalette={() => app.setPaletteOpen(false)}
        onNavigate={goToFromPalette}
      >
        <ErrorBoundary>
        {app.view === "dashboard" && (
          <DashboardView
            state={state}
            onNavigate={app.setView}
            onOpenSource={(assignmentId) =>
              void app.openAssignmentSource(assignmentId)
            }
          />
        )}
        {app.view === "schedule" && (
          <ScheduleView
            items={state.schedule}
            terms={app.visibleTerms}
            calendar={state.dataCatalog.collections.academicCalendar.calendar}
            onExportPdf={() => void app.exportSchedulePdf()}
            exportingPdf={app.exportingSchedulePdf}
          />
        )}
        {app.view === "map" && <CampusMapView />}
        {app.view === "exams" && (
          <ExamsView state={state} terms={app.visibleTerms} />
        )}
        {app.view === "grades" && (
          <GradesView
            grades={state.grades}
            gpa={state.academicProgress?.gpa ?? state.profile?.gpa}
            terms={app.visibleTerms}
          />
        )}
        {app.view === "progress" && (
          <AcademicProgressView
            progress={state.academicProgress}
            grades={state.grades}
            selectedCourses={state.selectedCourses}
            terms={app.visibleTerms}
          />
        )}
        {app.view === "courses" && (
          <CoursesView
            courses={state.courses}
            state={state}
            query={app.query}
            terms={app.visibleTerms}
          />
        )}
        {app.view === "selection" && (
          <CourseSelectionView
            portal={app.courseSelectionPortal}
            candidates={app.courseSelectionCandidates}
            candidateCatalogPage={app.courseSelectionCatalogPage}
            snapshot={app.courseSelection}
            loading={app.courseSelectionLoading}
            schoolSchedule={app.schoolSchedule}
            schoolScheduleLoading={app.schoolScheduleLoading}
            schoolScheduleError={app.schoolScheduleError}
            schoolScheduleRefreshFailed={app.schoolScheduleRefreshFailed}
            terms={app.visibleTerms}
            academicCalendarAnalysis={state.dataCatalog.collections.academicCalendar.analysis}
            onDiscover={() => void app.discoverCourseSelection()}
            onLoadCandidates={(blockId, target, options) =>
              void app.loadCourseSelectionCandidates(blockId, target, options)
            }
            onSearchSchoolSchedule={(query) => void app.searchSchoolSchedule(query)}
            onDismissSchoolScheduleError={app.dismissSchoolScheduleError}
            onSaveSchoolTarget={(target) => void app.saveCourseSelectionTarget(target)}
            onRemoveSchoolTarget={(id) => void app.removeCourseSelectionTarget(id)}
            onSetSentinel={(config) => void app.setCourseSelectionSentinel(config)}
            onStart={(options) => void app.startCourseSelection(options)}
            onStop={() => void app.stopCourseSelection()}
          />
        )}
        {app.view === "assignments" && (
          <AssignmentsView
            items={state.assignments}
            workspaces={state.workspaces}
            workingId={app.workingAssignmentId}
            onPrepare={app.prepareCourseWork}
            onOpenWorkspace={(assignmentId) =>
              void app.openCourseWork(assignmentId)
            }
            onImportAnswerKey={(assignmentId) =>
              void app.importCourseWorkFile(assignmentId, "answer-key")
            }
            onApplyTestAnswers={(assignmentId) =>
              void app.applyTestAnswers(assignmentId)
            }
            onOpenSubmission={(assignmentId) =>
              void app.openSubmission(assignmentId)
            }
            onOpenSource={(assignmentId) =>
              void app.openAssignmentSource(assignmentId)
            }
            onProcessWithModel={app.processCourseWorkWithModel}
            onGenerateNotes={app.generateNotes}
            onGeneratePaper={app.generatePaper}
            onRenderPdf={app.renderMdFile}
            onOpenPdf={app.openAnswerPdf}
            modelConfigured={app.modelStatus.configured}
          />
        )}
        {(app.view === "notices" || app.view === "mailbox") && (
          <CommunicationsView state={state} />
        )}
        {app.view === "tools" && (
          <ToolsView
            dataCatalog={state.dataCatalog}
            apiBase={app.apiBase}
            calendarAssetUrls={app.calendarAssetUrls}
          />
        )}
        </ErrorBoundary>
      </WorkspaceChrome>
      <SettingsView
        open={app.settingsOpen}
        onOpenChange={app.setSettingsOpen}
        state={state}
        apiBase={app.apiBase}
        auth={app.auth}
        credentials={app.credentials}
        academicApiCredentials={
          app.academicApiCredentialStatus || {
            saved: false,
            encryptionAvailable: false,
            enabled: false,
          }
        }
        mailCredentials={
          app.mailCredentialStatus || {
            saved: false,
            encryptionAvailable: false,
          }
        }
        modelStatus={app.modelStatus}
        syncing={app.syncing}
        syncProgress={app.syncProgress}
        onSync={() => void app.sync()}
        activityLog={app.activityLog}
        activityLoading={app.activityLoading}
        onRefreshActivity={() => void app.refreshActivityLog()}
        onAuthChange={app.setAuth}
        onCredentialChange={app.setCredentialStatus}
        onAcademicApiCredentialChange={app.setAcademicApiCredentialStatus}
        onMailCredentialChange={app.setMailCredentialStatus}
        onModelStatus={app.setModelStatus}
        onMessage={app.setMessage}
      />
      {isDesktop &&
        app.credentialStatus &&
        !app.credentialStatus.saved &&
        !app.credentialDismissed && (
          <CredentialSetupModal
            status={app.credentialStatus}
            onStatus={app.setCredentialStatus}
            onClose={() => app.setCredentialDismissed(true)}
            onMessage={app.setMessage}
          />
        )}
    </div>
    </div>
    </TooltipProvider>
  );
}
