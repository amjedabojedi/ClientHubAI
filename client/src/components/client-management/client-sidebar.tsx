import { useQuery } from "@tanstack/react-query";

export default function ClientSidebar() {
  const { data: stats } = useQuery({
    queryKey: ["/api/clients/stats"],
  });

  const { data: pendingTasks } = useQuery({
    queryKey: ["/api/tasks/pending/count"],
  });

  return (
    <aside className="w-64 bg-white border-r border-slate-200 p-6 hidden lg:block">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Quick Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600">Total Clients</p>
                <p className="text-xl font-bold text-primary">{stats?.totalClients?.toLocaleString() || '0'}</p>
              </div>
              <i className="fas fa-users text-primary"></i>
            </div>
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600">Active Today</p>
                <p className="text-xl font-bold text-emerald-600">{stats?.activeClients?.toLocaleString() || '0'}</p>
              </div>
              <i className="fas fa-calendar-check text-emerald-600"></i>
            </div>
            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600">Pending Tasks</p>
                <p className="text-xl font-bold text-amber-600">{pendingTasks?.count?.toLocaleString() || '0'}</p>
              </div>
              <i className="fas fa-tasks text-amber-600"></i>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6">
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">AI Insights</h3>
          <div className="space-y-3">
            <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg">
              <div className="flex items-start space-x-2">
                <i className="fas fa-lightbulb text-purple-500 mt-1"></i>
                <div>
                  <p className="text-sm font-medium text-slate-900">Risk Assessment Alert</p>
                  <p className="text-xs text-slate-600 mt-1">3 clients may need priority follow-up</p>
                </div>
              </div>
            </div>
            <div className="p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg">
              <div className="flex items-start space-x-2">
                <i className="fas fa-chart-line text-blue-500 mt-1"></i>
                <div>
                  <p className="text-sm font-medium text-slate-900">Progress Insights</p>
                  <p className="text-xs text-slate-600 mt-1">85% improvement rate this month</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
