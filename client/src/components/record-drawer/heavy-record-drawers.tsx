import { useRecordDrawer } from "@/contexts/RecordDrawerContext";
import ClientReportPage from "@/pages/client-report";
import AssessmentCompletionPage from "@/pages/assessment-completion";
import AssessmentReportPage from "@/pages/assessment-report";

/**
 * Thin wrappers that render the existing heavy full-page screens inside a
 * record drawer. They supply the record ids as props (so the page does not
 * rely on the URL) and wire the page's "Back" action to close the drawer.
 *
 * The original pages remain registered as standalone routes in App.tsx, so
 * their URLs keep working unchanged as deep-link entry points.
 */

export function ClientReportDrawer(props: { clientId?: number; reportId?: number }) {
  const { closeTopDrawer } = useRecordDrawer();
  return (
    <ClientReportPage
      clientId={props.clientId}
      reportId={props.reportId}
      onClose={closeTopDrawer}
    />
  );
}

export function AssessmentCompletionDrawer(props: { assignmentId?: number }) {
  const { closeTopDrawer, replaceTopDrawer } = useRecordDrawer();
  return (
    <AssessmentCompletionPage
      assignmentId={props.assignmentId}
      onClose={closeTopDrawer}
      onOpenReport={(assignmentId) => {
        // Lateral switch to the report: replace the current drawer in place so
        // we stay at the same depth (and the same history entry) instead of
        // stacking another level.
        replaceTopDrawer({
          type: "assessment-report",
          title: "Assessment Report",
          size: "wide",
          props: { assignmentId },
        });
      }}
    />
  );
}

export function AssessmentReportDrawer(props: { assignmentId?: number }) {
  const { closeTopDrawer, replaceTopDrawer } = useRecordDrawer();
  return (
    <AssessmentReportPage
      assignmentId={props.assignmentId}
      onClose={closeTopDrawer}
      onOpenCompletion={(assignmentId) => {
        replaceTopDrawer({
          type: "assessment-completion",
          title: "Complete Assessment",
          size: "wide",
          props: { assignmentId },
        });
      }}
    />
  );
}
